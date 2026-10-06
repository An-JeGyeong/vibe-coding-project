package com.mangabridge.bootstrap.episode;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.math.BigInteger;
import java.net.ServerSocket;
import java.sql.Statement;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.*;
import org.springframework.core.Ordered;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(EpisodeSourceIntegrationTest.Fixtures.class)
class EpisodeSourceIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper mapper;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @Autowired FixtureAddress address;
    @MockitoSpyBean EpisodeDao dao;
    private final Set<Long> accounts=new HashSet<>();
    private final Set<String> loginIds=new HashSet<>();
    private String operator,password;
    private record Identity(long id,String token) { }
    static class FixtureAddress { volatile String current; }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao trackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
        @Bean FixtureAddress episodeFixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> episodeFixtureFilter(FixtureAddress address) {
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    @BeforeEach void setup() {
        address.current="fixture.episode."+UUID.randomUUID(); password=UUID.randomUUID().toString();
        operator=identity(Role.OPERATOR).token();
    }
    private Identity identity(Role role) {
        String loginId="test.episode."+UUID.randomUUID(); loginIds.add(loginId);
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setString(1,loginId); statement.setString(2,"검증 계정"); statement.setString(3,role.name());
            statement.setString(4,encoder.encode(password)); return statement;
        },key);
        long id=key.getKey().longValue(); accounts.add(id);
        var response=http.postForEntity("/api/auth/login",Map.of("loginId",loginId,"password",password),JsonNode.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return new Identity(id,response.getBody().get("accessToken").textValue());
    }
    @AfterEach void cleanup() {
        reset(dao);
        tracking.cleanupAudits();
        // Exact actor IDs belong to this test, including audit failures/rolled-back creates.
        for(long actor:accounts) {
            var episodes=jdbc.queryForList("SELECT id FROM episode WHERE created_by=?",Long.class,actor);
            for(long id:episodes) {
                jdbc.update("DELETE FROM source_block WHERE episode_id=?",id);
                jdbc.update("DELETE FROM episode_source_version WHERE episode_id=?",id);
                jdbc.update("DELETE FROM domain_audit WHERE episode_id=?",id);
                jdbc.update("DELETE FROM episode WHERE id=?",id);
            }
            jdbc.update("DELETE FROM domain_audit WHERE actor_account_id=?",actor);
            jdbc.update("DELETE FROM auth_token WHERE account_id=?",actor);
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?",actor);
            jdbc.update("DELETE FROM demo_account WHERE id=?",actor);
        }
        for(String id:loginIds) jdbc.update("DELETE FROM auth_login_limit WHERE limit_key=?",digest("id:"+id));
        jdbc.update("DELETE FROM auth_login_limit WHERE limit_key=?",digest("ip:"+address.current));
    }
    private static byte[] digest(String input) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(input.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch(Exception error) { throw new AssertionError(error); }
    }
    private ResponseEntity<JsonNode> request(HttpMethod method,String path,Object body,String token) {
        HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON);
        if(token!=null) headers.setBearerAuth(token);
        return http.exchange(path,method,new HttpEntity<>(body,headers),JsonNode.class);
    }
    private ResponseEntity<JsonNode> get(String path) { return request(HttpMethod.GET,path,null,operator); }
    private String create(String title) {
        var response=request(HttpMethod.POST,"/api/episodes",Map.of("title",title),operator);
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("id","title","latestSourceVersion","createdAt");
        Instant.parse(response.getBody().get("createdAt").textValue());
        return response.getBody().get("id").textValue();
    }
    private Map<String,Object> source(Object expected,Object... blocks) { return Map.of("expectedVersion",expected,"blocks",List.of(blocks)); }
    private Map<String,Object> block(String text) { return Map.of("text",text); }
    private ResponseEntity<JsonNode> save(String id,Object payload) { return request(HttpMethod.PUT,"/api/episodes/"+id+"/source",payload,operator); }
    private void error(ResponseEntity<JsonNode> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        JsonNode body=response.getBody();
        assertThat(body.fieldNames()).toIterable().containsExactly("error");
        assertThat(body.get("error").get("code").textValue()).isEqualTo(code);
        assertThat(body.get("error").get("message").textValue()).isNotBlank();
        assertThat(body.toString()).doesNotContain("jdbc:","Exception","stackTrace",password,"SECRET","password_hash","127.0.0.1");
    }
    @Test void createListAndEmptyDetail() {
        String one=create("  첫 회차 😀  "),two=create("둘째");
        var detail=get("/api/episodes/"+one); assertThat(detail.getStatusCode().value()).isEqualTo(200);
        assertThat(detail.getBody().get("title").textValue()).isEqualTo("  첫 회차 😀  ");
        assertThat(detail.getBody().get("source").isNull()).isTrue();
        assertThat(detail.getBody().get("latestSourceVersion").intValue()).isZero();
        var list=get("/api/episodes?limit=1&offset=0");
        assertThat(list.getBody().get("items").get(0).get("id").textValue()).isEqualTo(two);
        assertThat(get("/api/episodes?limit=1&offset=1").getBody().get("items").get(0).get("id").textValue()).isEqualTo(one);
        assertThat(get("/api/episodes?limit=100&offset=999999999999999999999").getBody().get("items").size()).isZero();
        assertThat(get("/api/episodes/"+one+"/source/versions").getBody().get("items").size()).isZero();
        for(String query:List.of("limit=0","limit=101","limit=1.0","offset=-1","offset=x")) error(get("/api/episodes?"+query),400,"INVALID_REQUEST");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM domain_audit WHERE episode_id=? AND event='EPISODE_CREATED'",Integer.class,one)).isEqualTo(1);
    }
    @Test void titleCodePointBoundariesAndInvalidInputs() {
        create("😀".repeat(100)); create("a");
        for(Object title:List.of("","a".repeat(101),"😀".repeat(101)," \t ","\u00a0","x\u0001","x\n",true,42)) {
            error(request(HttpMethod.POST,"/api/episodes",Map.of("title",title),operator),400,"INVALID_REQUEST");
        }
        error(request(HttpMethod.POST,"/api/episodes",Map.of(),operator),400,"INVALID_REQUEST");
        error(request(HttpMethod.POST,"/api/episodes",Map.of("title","ok","role","OPERATOR"),operator),400,"INVALID_REQUEST");
    }
    @Test void versionsAreImmutableNoopDoesNotWriteAndConflictIncludesLatest() {
        String id=create("제목");
        var first=source(0,Map.of("pageNo",1,"text"," 원문\t\n\r "),block("둘"));
        var saved=save(id,first); assertThat(saved.getStatusCode().value()).isEqualTo(201);
        JsonNode original=get("/api/episodes/"+id+"/source/versions/1").getBody();
        Instant.parse(original.get("savedAt").textValue());
        assertThat(original.get("blocks").get(0).get("seq").intValue()).isEqualTo(1);
        assertThat(original.get("blocks").get(1).get("pageNo").isNull()).isTrue();
        var before=get("/api/episodes/"+id).getBody();
        var noop=save(id,source(1,Map.of("pageNo",1,"text"," 원문\t\n\r "),block("둘")));
        assertThat(noop.getStatusCode().value()).isEqualTo(200);
        assertThat(noop.getBody()).isEqualTo(mapper.valueToTree(Map.of("version",1,"changed",false)));
        assertThat(get("/api/episodes/"+id).getBody()).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM domain_audit WHERE episode_id=?",Integer.class,id)).isEqualTo(2);
        var conflict=save(id,first); error(conflict,409,"VERSION_CONFLICT");
        assertThat(conflict.getBody().get("error").get("latestVersion").intValue()).isEqualTo(1);
        assertThat(save(id,source(1,block("둘"),Map.of("pageNo",1,"text"," 원문\t\n\r "))).getStatusCode().value()).isEqualTo(201);
        assertThat(get("/api/episodes/"+id+"/source/versions/1").getBody()).isEqualTo(original);
        assertThat(get("/api/episodes/"+id+"/source/versions").getBody().get("items").get(0).get("version").intValue()).isEqualTo(2);
        assertThat(get("/api/episodes/"+id).getBody().get("source").get("version").intValue()).isEqualTo(2);
    }
    @Test void sourceBoundariesAndStrictJsonTypes() {
        String id=create("경계");
        List<Object> blocks=new ArrayList<>();
        for(int i=0;i<200;i++) blocks.add(Map.of("pageNo",9999,"text","😀".repeat(2000)));
        assertThat(save(id,Map.of("expectedVersion",0,"blocks",blocks)).getStatusCode().value()).isEqualTo(201);
        blocks.add(block("x")); error(save(id,Map.of("expectedVersion",1,"blocks",blocks)),400,"INVALID_REQUEST");
        for(Object expected:List.of(-1,1.5,"1",true)) error(save(id,source(expected,block("x"))),400,"INVALID_REQUEST");
        for(Object page:List.of(0,10000,1.5,"1",true)) error(save(id,source(1,Map.of("pageNo",page,"text","x"))),400,"INVALID_REQUEST");
        for(Object text:List.of("","😀".repeat(2001)," \t\r\n ","\u00a0","x\u0000","x\u007f",false,1))
            error(save(id,source(1,Map.of("text",text))),400,"INVALID_REQUEST");
        error(save(id,Map.of("expectedVersion",1,"blocks",List.of())),400,"INVALID_REQUEST");
        error(save(id,Map.of("blocks",List.of(block("x")))),400,"INVALID_REQUEST");
        error(save(id,source(1,Map.of("seq",1,"text","x"))),400,"INVALID_REQUEST");
        error(save(id,Map.of("expectedVersion",1,"blocks",Arrays.asList((Object)null))),400,"INVALID_REQUEST");
        var nullPage=new HashMap<String,Object>(); nullPage.put("pageNo",null); nullPage.put("text","x");
        assertThat(save(id,source(1,nullPage)).getStatusCode().value()).isEqualTo(201);
        error(save(id,source(new BigInteger("99999999999999999999"),block("x"))),409,"VERSION_CONFLICT");
    }
    @Test void pathIdsAndVersionsUseNotFound() {
        String id=create("경로");
        for(String invalid:List.of("0","01","-1","abc","1.2","1000000000000000000")) {
            error(get("/api/episodes/"+invalid),404,"NOT_FOUND");
            error(get("/api/episodes/"+invalid+"/source/versions"),404,"NOT_FOUND");
            error(get("/api/episodes/"+id+"/source/versions/"+invalid),404,"NOT_FOUND");
        }
        error(get("/api/episodes/999999999999999999"),404,"NOT_FOUND");
        error(get("/api/episodes/"+id+"/source/versions/1"),404,"NOT_FOUND");
        error(save("999999999999999999",source(0,block("x"))),404,"NOT_FOUND");
    }
    @Test void sameExpectedVersionConcurrentWritesHaveOneWinner() throws Exception {
        String id=create("동시 저장"); var pool=Executors.newFixedThreadPool(2); var ready=new CountDownLatch(2); var start=new CountDownLatch(1);
        try {
            List<Future<Integer>> jobs=new ArrayList<>();
            for(String text:List.of("first","second")) jobs.add(pool.submit(()->{ ready.countDown(); start.await(); return save(id,source(0,block(text))).getStatusCode().value(); }));
            assertThat(ready.await(5,TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(jobs.get(0).get(20,TimeUnit.SECONDS),jobs.get(1).get(20,TimeUnit.SECONDS))).containsExactlyInAnyOrder(201,409);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM episode_source_version WHERE episode_id=?",Integer.class,id)).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM domain_audit WHERE episode_id=? AND event='SOURCE_SAVED'",Integer.class,id)).isEqualTo(1);
        } finally { start.countDown(); pool.shutdownNow(); }
    }
    @Test void fourRolesAcrossSixApisAndForgedRoleAreEnforced() {
        String id=create("권한"); assertThat(save(id,source(0,block("x"))).getStatusCode().value()).isEqualTo(201);
        List<HttpMethod> methods=List.of(HttpMethod.POST,HttpMethod.GET,HttpMethod.GET,HttpMethod.PUT,HttpMethod.GET,HttpMethod.GET);
        List<String> paths=List.of("/api/episodes","/api/episodes","/api/episodes/"+id,"/api/episodes/"+id+"/source","/api/episodes/"+id+"/source/versions","/api/episodes/"+id+"/source/versions/1");
        List<Object> bodies=Arrays.asList(Map.of("title","matrix"),null,null,source(1,block("x")),null,null);
        for(int i=0;i<6;i++) error(request(methods.get(i),paths.get(i),bodies.get(i),null),401,"AUTH_REQUIRED");
        for(Role role:Role.values()) {
            Identity identity=identity(role);
            for(int i=0;i<6;i++) {
                var response=request(methods.get(i),paths.get(i),bodies.get(i),identity.token());
                if(role==Role.OPERATOR) {
                    assertThat(response.getStatusCode().value()).isEqualTo(i==0?201:200);
                    assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
                } else error(response,403,"FORBIDDEN");
            }
            if(role!=Role.OPERATOR) assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_audit WHERE account_id=? AND event='ACCESS_DENIED'",Integer.class,identity.id())).isEqualTo(6);
        }
        Identity reader=identity(Role.READER);
        HttpHeaders forged=new HttpHeaders(); forged.setBearerAuth(reader.token()); forged.set("X-Role","OPERATOR"); forged.set("X-User-Id",Long.toString(accounts.iterator().next()));
        error(http.exchange("/api/episodes",HttpMethod.GET,new HttpEntity<>(forged),JsonNode.class),403,"FORBIDDEN");
        error(request(HttpMethod.POST,"/api/episodes",Map.of("title","x","role","OPERATOR"),reader.token()),403,"FORBIDDEN");
        error(request(HttpMethod.POST,"/api/episodes",Map.of("title","x","userId","1"),operator),400,"INVALID_REQUEST");
    }
    @Test void malformedAndNonJsonBodiesAndCorsPreflight() {
        String id=create("프로토콜");
        for(String path:List.of("/api/episodes","/api/episodes/"+id+"/source")) {
            HttpMethod method=path.endsWith("/source")?HttpMethod.PUT:HttpMethod.POST;
            for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED,MediaType.APPLICATION_JSON)) {
                HttpHeaders headers=new HttpHeaders(); headers.setBearerAuth(operator); headers.setContentType(type);
                error(http.exchange(path,method,new HttpEntity<>("{broken SECRET",headers),JsonNode.class),400,"INVALID_REQUEST");
            }
            error(request(method,path,null,operator),400,"INVALID_REQUEST");
        }
        HttpHeaders headers=new HttpHeaders(); headers.setOrigin("http://localhost:3000"); headers.setAccessControlRequestMethod(HttpMethod.PUT);
        headers.setAccessControlRequestHeaders(List.of("Content-Type","Authorization"));
        var preflight=http.exchange("/api/episodes/"+id+"/source",HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
        assertThat(preflight.getStatusCode().value()).isEqualTo(200);
        assertThat(preflight.getHeaders().getAccessControlAllowMethods()).contains(HttpMethod.PUT);
        assertThat(preflight.getHeaders().getAccessControlAllowHeaders()).contains("Content-Type","Authorization");
        assertThat(preflight.getHeaders().getFirst("Access-Control-Allow-Credentials")).isNull();
    }
    @Test void auditFailureRollsBackCreateAndSourceSave() {
        String id=create("롤백"); JsonNode before=get("/api/episodes/"+id).getBody();
        long count=jdbc.queryForObject("SELECT count(*) FROM episode",Long.class);
        doThrow(new DataIntegrityViolationException("SECRET database exception")).when(dao).audit(anyLong(),anyString(),anyLong(),nullable(Integer.class),any(Instant.class));
        error(request(HttpMethod.POST,"/api/episodes",Map.of("title","rollback SECRET"),operator),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM episode",Long.class)).isEqualTo(count);
        error(save(id,source(0,block("rollback SECRET"))),503,"SERVICE_UNAVAILABLE");
        assertThat(get("/api/episodes/"+id).getBody()).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM episode_source_version WHERE episode_id=?",Integer.class,id)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM source_block WHERE episode_id=?",Integer.class,id)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM domain_audit WHERE episode_id=?",Integer.class,id)).isEqualTo(1);
    }
    @Test void actualConnectionFailureReturnsSafe503() throws Exception {
        int unavailable;
        try(var socket=new ServerSocket(0)) { unavailable=socket.getLocalPort(); }
        var broken=new DriverManagerDataSource("jdbc:mysql://127.0.0.1:"+unavailable+"/unavailable?connectTimeout=2000&socketTimeout=3000","unused","unused");
        var disconnected=new EpisodeDao(new JdbcTemplate(broken));
        doAnswer(invocation->disconnected.countEpisodes()).when(dao).countEpisodes();
        error(get("/api/episodes"),503,"SERVICE_UNAVAILABLE");
    }
    @Test void actualMigrationsForeignKeysUniquenessChecksAndAuditSchema() {
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version IN ('6','7','8','9') AND success=1",Integer.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('episode','episode_source_version','source_block','domain_audit') AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_0900_ai_ci'",Integer.class)).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit' AND COLUMN_NAME='event'",String.class)).isEqualTo("ascii_bin");
        String id=create("제약"); assertThat(save(id,source(0,block("x"))).getStatusCode().value()).isEqualTo(201);
        assertThatThrownBy(()->jdbc.update("INSERT INTO episode_source_version(episode_id,version_no) VALUES (?,1)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO episode_source_version(episode_id,version_no) VALUES (999999999999999999,1)")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO episode(title,created_by) VALUES ('invalid',999999999999999999)")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO episode_source_version(episode_id,version_no,created_by) VALUES (?,2,999999999999999999)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO source_block(episode_id,version_no,seq) VALUES (?,999,1)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO source_block(episode_id,version_no,seq) VALUES (?,1,0)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO source_block(episode_id,version_no,seq,page_no) VALUES (?,1,2,10000)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO source_block(episode_id,version_no,seq,page_no) VALUES (?,1,2,0)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO source_block(episode_id,version_no,seq) VALUES (?,1,1)",id)).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO domain_audit(actor_account_id) VALUES (999999999999999999)")).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("INSERT INTO domain_audit(actor_account_id) VALUES (NULL)")).isInstanceOf(DataAccessException.class);
        assertThat(jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit'",String.class))
                .containsExactlyInAnyOrder("id","occurred_at","actor_account_id","event","episode_id","source_version","translation_version_id");
    }
}
