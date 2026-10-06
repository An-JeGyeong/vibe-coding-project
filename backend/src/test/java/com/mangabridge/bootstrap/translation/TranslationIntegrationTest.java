package com.mangabridge.bootstrap.translation;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import java.time.Clock;
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.net.ServerSocket;
import java.sql.Statement;
import java.sql.SQLException;
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
@Import(TranslationIntegrationTest.Fixtures.class)
class TranslationIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @Autowired FixtureAddress address;
    @MockitoSpyBean TranslationDao dao;
    @MockitoSpyBean EpisodeDao sourceDao;
    private final Set<Long> accounts=new HashSet<>();
    private final Set<String> loginIds=new HashSet<>();
    private final Set<String> episodes=new HashSet<>();
    private Identity operator;
    private String password;
    private record Identity(long id,String token) { }
    static class FixtureAddress { volatile String current; }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao translationTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
        @Bean FixtureAddress translationFixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> translationFixtureFilter(FixtureAddress address) {
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    @BeforeEach void setup() {
        address.current="fixture.translation."+UUID.randomUUID(); password=UUID.randomUUID().toString();
        operator=identity(Role.OPERATOR);
    }
    private Identity identity(Role role) {
        String loginId="test.translation."+UUID.randomUUID(); loginIds.add(loginId);
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setString(1,loginId); statement.setString(2,"배정 검증 계정"); statement.setString(3,role.name());
            statement.setString(4,encoder.encode(password)); return statement;
        },key);
        long id=key.getKey().longValue(); accounts.add(id);
        var response=http.postForEntity("/api/auth/login",Map.of("loginId",loginId,"password",password),JsonNode.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return new Identity(id,response.getBody().get("accessToken").textValue());
    }
    @AfterEach void cleanup() {
        reset(dao,sourceDao); tracking.cleanupAudits();
        for(String id:episodes) {
            jdbc.update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?",id);
            jdbc.update("DELETE FROM publication WHERE episode_id=?",id);
            jdbc.update("DELETE FROM review_decision WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);
            jdbc.update("DELETE FROM translation_block WHERE episode_id=?",id);
            jdbc.update("DELETE FROM translation_version WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode_assignment WHERE episode_id=?",id);
            jdbc.update("DELETE FROM source_block WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode_source_version WHERE episode_id=?",id);
            jdbc.update("DELETE FROM domain_audit WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode WHERE id=?",id);
        }
        for(long actor:accounts) {
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
    private ResponseEntity<JsonNode> get(String path,String token) { return request(HttpMethod.GET,path,null,token); }
    private ResponseEntity<JsonNode> get(String path) { return get(path,operator.token()); }
    private String create(String title) {
        var response=request(HttpMethod.POST,"/api/episodes",Map.of("title",title),operator.token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        String id=response.getBody().get("id").textValue(); episodes.add(id); return id;
    }
    private String assignments(String id) { return "/api/episodes/"+id+"/assignments"; }
    private ResponseEntity<JsonNode> assign(String id,String role,long account) {
        return request(HttpMethod.PUT,assignments(id)+"/"+role,Map.of("accountId",Long.toString(account)),operator.token());
    }
    private int audits(String id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='ASSIGNED'",Integer.class,id);
    }
    private void error(ResponseEntity<JsonNode> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        JsonNode body=response.getBody();
        assertThat(body.fieldNames()).toIterable().containsExactly("error");
        assertThat(body.get("error").fieldNames()).toIterable().contains("code","message");
        assertThat(body.get("error").fieldNames()).toIterable().isSubsetOf("code","message","latestRevision","currentStatus","missingSeqs");
        assertThat(body.get("error").get("code").textValue()).isEqualTo(code);
        assertThat(body.get("error").get("message").textValue()).isNotBlank();
        assertThat(body.toString()).doesNotContain("jdbc:","Exception","stackTrace",password,"SECRET","password_hash","127.0.0.1",operator.token());
    }

    private String translations(String id) { return "/api/my/episodes/"+id+"/translations"; }
    private ResponseEntity<JsonNode> source(String id,int expected,int count,String text) {
        var blocks=new ArrayList<Map<String,Object>>();
        for(int i=1;i<=count;i++) blocks.add(i==1?Map.of("pageNo",3,"text",text+i):Map.of("text",text+i));
        return request(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",expected,"blocks",blocks),operator.token());
    }
    private String prepared(Identity translator) {
        String id=create("  translation fixture  ");
        assertThat(source(id,0,2,"원문 😀 ").getStatusCode().value()).isEqualTo(201);
        assertThat(assign(id,"translator",translator.id()).getStatusCode().value()).isEqualTo(201);
        return id;
    }
    private ResponseEntity<JsonNode> start(String id,Identity translator) { return request(HttpMethod.POST,translations(id),null,translator.token()); }
    private Map<String,Object> draft(int revision,Object... pairs) {
        var blocks=new ArrayList<Map<String,Object>>();
        for(int i=0;i<pairs.length;i+=2) blocks.add(Map.of("seq",pairs[i],"text",pairs[i+1]));
        return Map.of("expectedRevision",revision,"blocks",blocks);
    }
    private ResponseEntity<JsonNode> save(String id,int version,Object body,Identity translator) {
        return request(HttpMethod.PUT,translations(id)+"/"+version,body,translator.token());
    }
    private ResponseEntity<JsonNode> submit(String id,int version,int revision,Identity translator) {
        return request(HttpMethod.POST,translations(id)+"/"+version+"/submit",Map.of("expectedRevision",revision),translator.token());
    }
    private long translationId(String id,int version) {
        return jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=? AND version_no=?",Long.class,id,version);
    }
    private int domainCount(String id,String event) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event=?",Integer.class,id,event);
    }
    private void approved(String id,long translation,Identity reviewer) {
        jdbc.update("UPDATE translation_version SET status='APPROVED' WHERE id=?",translation);
        jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) VALUES (?,'APPROVED',?,1,UTC_TIMESTAMP(6))",translation,reviewer.id());
    }
    @Test void creationDetailListNoopRevisionAndSubmissionFollowExactContract() {
        Identity translator=identity(Role.TRANSLATOR); String id=prepared(translator);
        assertThat(get(translations(id),translator.token()).getBody().get("items")).isEmpty();
        var created=start(id,translator); assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(created.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","sourceVersion","revision");
        assertThat(created.getBody().get("revision").intValue()).isEqualTo(1);
        error(start(id,translator),409,"STATE_CONFLICT");
        var detail=get(translations(id)+"/1",translator.token());
        assertThat(detail.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","sourceVersion","revision","createdAt","submittedAt","editable","blocks","decision");
        assertThat(detail.getBody().get("decision").isNull()).isTrue();
        assertThat(detail.getBody().get("editable").booleanValue()).isTrue();
        assertThat(detail.getBody().get("createdAt").textValue()).endsWith("Z");
        assertThat(detail.getBody().get("submittedAt").isNull()).isTrue();
        var blocks=detail.getBody().get("blocks"); assertThat(blocks.size()).isEqualTo(2);
        assertThat(blocks.get(0).get("source").textValue()).isEqualTo("원문 😀 1");
        assertThat(blocks.get(0).get("pageNo").intValue()).isEqualTo(3);
        assertThat(blocks.get(1).get("pageNo").isNull()).isTrue();
        assertThat(blocks.get(0).get("text").isNull()).isTrue();
        var unchanged=save(id,1,draft(1),translator);
        assertThat(unchanged.getBody().get("changed").booleanValue()).isFalse();
        verify(dao,never()).replace(anyLong(),any(),anyMap());
        int auditCount=jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=?",Integer.class,id);
        String first="  번역 😀\t\n\r  ",second="second";
        var saved=save(id,1,draft(1,2,second,1,first),translator);
        assertThat(saved.getStatusCode().value()).isEqualTo(200);
        assertThat(saved.getBody().get("revision").intValue()).isEqualTo(2);
        assertThat(saved.getBody().get("changed").booleanValue()).isTrue();
        reset(dao);
        assertThat(save(id,1,draft(2,1,first,2,second),translator).getBody().get("changed").booleanValue()).isFalse();
        verify(dao,never()).replace(anyLong(),any(),anyMap());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=?",Integer.class,id)).isEqualTo(auditCount);
        var stale=save(id,1,draft(1,1,"lost"),translator); error(stale,409,"VERSION_CONFLICT");
        assertThat(stale.getBody().get("error").get("latestRevision").intValue()).isEqualTo(2);
        error(submit(id,1,1,translator),409,"VERSION_CONFLICT");
        var submitted=submit(id,1,2,translator); assertThat(submitted.getStatusCode().value()).isEqualTo(200);
        assertThat(submitted.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","submittedAt");
        assertThat(submitted.getBody().get("status").textValue()).isEqualTo("REVIEW_PENDING");
        assertThat(submitted.getBody().get("submittedAt").textValue()).endsWith("Z");
        var readonly=get(translations(id)+"/1",translator.token()).getBody();
        assertThat(readonly.get("editable").booleanValue()).isFalse();
        assertThat(readonly.get("blocks").get(0).get("text").textValue()).isEqualTo(first);
        var denied=save(id,1,draft(2),translator); error(denied,409,"STATE_CONFLICT");
        assertThat(denied.getBody().get("error").get("currentStatus").textValue()).isEqualTo("REVIEW_PENDING");
        error(submit(id,1,2,translator),409,"STATE_CONFLICT");
        error(start(id,translator),409,"STATE_CONFLICT");
        var list=get(translations(id),translator.token()).getBody();
        assertThat(list.fieldNames()).toIterable().containsExactlyInAnyOrder("latestSourceVersion","items");
        assertThat(list.get("items").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","sourceVersion","revision","createdAt","submittedAt","decision");
        assertThat(list.get("items").get(0).get("decision").isNull()).isTrue();
        assertThat(domainCount(id,"TRANSLATION_CREATED")).isEqualTo(1);
        assertThat(domainCount(id,"TRANSLATION_SUBMITTED")).isEqualTo(1);
    }
    @Test void incompleteAndFullReplacementAndTextCodePointBoundaries() {
        Identity translator=identity(Role.TRANSLATOR); String id=prepared(translator); start(id,translator);
        var missing=submit(id,1,1,translator); error(missing,400,"INCOMPLETE_TRANSLATION");
        assertThat(missing.getBody().get("error").get("missingSeqs").toString()).isEqualTo("[1,2]");
        assertThat(save(id,1,draft(1,1,"😀".repeat(4000)),translator).getStatusCode().value()).isEqualTo(200);
        jdbc.update("UPDATE translation_block SET body=' \t\n' WHERE translation_version_id=? AND source_seq=1",translationId(id,1));
        var blankStored=submit(id,1,2,translator);error(blankStored,400,"INCOMPLETE_TRANSLATION");
        assertThat(blankStored.getBody().get("error").get("missingSeqs").toString()).isEqualTo("[1,2]");
        jdbc.update("UPDATE translation_block SET body=? WHERE translation_version_id=? AND source_seq=1","😀".repeat(4000),translationId(id,1));
        missing=submit(id,1,2,translator); error(missing,400,"INCOMPLETE_TRANSLATION");
        assertThat(missing.getBody().get("error").get("missingSeqs").toString()).isEqualTo("[2]");
        for(String text:List.of(""," \t\n\r\u00a0\u3000","x\u0000","x\u000b","x\u007f","x\u0085","😀".repeat(4001)))
            error(save(id,1,draft(2,1,text),translator),400,"INVALID_REQUEST");
        for(Object invalid:List.of(draft(2,99,"unknown"),draft(2,1,"a",1,"b"),draft(2,"1","a"),draft(2,1.0,"a"),draft(2,0,"a"),
                Map.of("expectedRevision",0,"blocks",List.of()),Map.of("expectedRevision","2","blocks",List.of()),Map.of("expectedRevision",2.0,"blocks",List.of())))
            error(save(id,1,invalid,translator),400,"INVALID_REQUEST");
        assertThat(save(id,1,draft(2,2,"one codepoint"),translator).getBody().get("revision").intValue()).isEqualTo(3);
        var detail=get(translations(id)+"/1",translator.token()).getBody();
        assertThat(detail.get("blocks").get(0).get("text").isNull()).isTrue();
        assertThat(detail.get("blocks").get(1).get("text").textValue()).isEqualTo("one codepoint");
        assertThat(save(id,1,draft(3),translator).getBody().get("revision").intValue()).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_block WHERE episode_id=?",Integer.class,id)).isZero();
    }
    @Test void laterVersionsCopyOnlyExistingSeqAndListDescendingWithoutMutatingHistory() {
        Identity translator=identity(Role.TRANSLATOR); String id=prepared(translator); start(id,translator);
        save(id,1,draft(1,1," keep \n",2,"deleted seq"),translator);
        assertThat(source(id,1,1,"new source ").getStatusCode().value()).isEqualTo(201);
        var created=start(id,translator); assertThat(created.getBody().get("versionNo").intValue()).isEqualTo(2);
        var detail=get(translations(id)+"/2",translator.token()).getBody();
        assertThat(detail.get("blocks").size()).isEqualTo(1);
        assertThat(detail.get("blocks").get(0).get("text").textValue()).isEqualTo(" keep \n");
        assertThat(detail.get("sourceVersion").intValue()).isEqualTo(2);
        var old=get(translations(id)+"/1",translator.token()).getBody();
        assertThat(old.get("blocks").size()).isEqualTo(2);
        assertThat(old.get("blocks").get(1).get("text").textValue()).isEqualTo("deleted seq");
        assertThat(old.get("editable").booleanValue()).isFalse();
        var list=get(translations(id),translator.token()).getBody().get("items");
        assertThat(list.get(0).get("versionNo").intValue()).isEqualTo(2);
        assertThat(list.get(1).get("versionNo").intValue()).isEqualTo(1);
        jdbc.update("UPDATE translation_version SET status='REJECTED' WHERE id=?",translationId(id,2));
        assertThat(start(id,translator).getBody().get("versionNo").intValue()).isEqualTo(3);
        assertThat(get(translations(id)+"/3",translator.token()).getBody().get("blocks").get(0).get("text").textValue()).isEqualTo(" keep \n");
    }
    @Test void submissionRejectsSourceVersionMismatchEvenWithCompleteDraftFixture() {
        Identity translator=identity(Role.TRANSLATOR);String id=prepared(translator);start(id,translator);
        save(id,1,draft(1,1,"a",2,"b"),translator);
        jdbc.update("INSERT INTO episode_source_version(episode_id,version_no,created_by,created_at,block_count) VALUES (?,2,?,UTC_TIMESTAMP(6),1)",id,operator.id());
        jdbc.update("INSERT INTO source_block(episode_id,version_no,seq,body) VALUES (?,2,1,'latest source')",id);
        jdbc.update("UPDATE episode SET latest_source_version=2 WHERE id=?",id);
        error(submit(id,1,2,translator),409,"STATE_CONFLICT");
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,translationId(id,1))).isEqualTo("DRAFT");
        assertThat(domainCount(id,"TRANSLATION_SUBMITTED")).isZero();
    }
    @Test void rolesAssignmentScopeReplacementAndSpoofingAreServerEnforced() {
        Identity translator=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER),reader=identity(Role.READER);
        String id=prepared(translator); assign(id,"reviewer",reviewer.id()); start(id,translator);
        var methods=List.of(HttpMethod.GET,HttpMethod.POST,HttpMethod.GET,HttpMethod.PUT,HttpMethod.POST);
        var paths=List.of(translations(id),translations(id),translations(id)+"/1",translations(id)+"/1",translations(id)+"/1/submit");
        var bodies=Arrays.asList(null,null,null,draft(1,1,"a",2,"b"),Map.of("expectedRevision",1));
        int before=jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED'",Integer.class);
        for(int i=0;i<paths.size();i++) {
            error(request(methods.get(i),paths.get(i),bodies.get(i),null),401,"AUTH_REQUIRED");
            for(Identity denied:List.of(operator,reviewer,reader))
                error(request(methods.get(i),paths.get(i),bodies.get(i),denied.token()),403,"FORBIDDEN");
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED'",Integer.class)).isEqualTo(before+15);
        var headers=new HttpHeaders();headers.setBearerAuth(reviewer.token());headers.set("X-Role","TRANSLATOR");headers.set("X-User-Id",Long.toString(translator.id()));
        error(http.exchange(translations(id),HttpMethod.GET,new HttpEntity<>(headers),JsonNode.class),403,"FORBIDDEN");
        Identity other=identity(Role.TRANSLATOR);
        for(int i=0;i<paths.size();i++) error(request(methods.get(i),paths.get(i),bodies.get(i),other.token()),404,"NOT_FOUND");
        assertThat(assign(id,"translator",other.id()).getStatusCode().value()).isEqualTo(200);
        for(int i=0;i<paths.size();i++) error(request(methods.get(i),paths.get(i),bodies.get(i),translator.token()),404,"NOT_FOUND");
        assertThat(save(id,1,draft(1,1,"new assignee",2,"translation"),other).getStatusCode().value()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT created_by FROM translation_version WHERE id=?",Long.class,translationId(id,1))).isEqualTo(translator.id());
        error(save(id,1,Map.of("expectedRevision",2,"blocks",List.of(),"role","TRANSLATOR"),other),400,"INVALID_REQUEST");
        assertThat(submit(id,1,2,other).getStatusCode().value()).isEqualTo(200);
    }
    @Test void protocolPathsPreflightNoSourceAndErrorBodiesRemainSafe() {
        Identity translator=identity(Role.TRANSLATOR); String id=prepared(translator); start(id,translator);
        String empty=create("no source"); assign(empty,"translator",translator.id());
        error(start(empty,translator),409,"STATE_CONFLICT");
        error(get(translations(id)+"/999",translator.token()),404,"NOT_FOUND");
        for(String version:List.of("0","01","-1","1.0","1000000000","not-a-version"))
            error(get(translations(id)+"/"+version,translator.token()),404,"NOT_FOUND");
        for(String pathId:List.of("0","01","-1","1000000000000000000")) error(get(translations(pathId),translator.token()),404,"NOT_FOUND");
        for(String path:List.of(translations(id),translations(id)+"/1",translations(id)+"/1/submit")) {
            HttpMethod method=path.endsWith("/1")?HttpMethod.PUT:HttpMethod.POST;
            for(MediaType content:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
                var headers=new HttpHeaders();headers.setContentType(content);headers.setBearerAuth(translator.token());
                error(http.exchange(path,method,new HttpEntity<>("invalid",headers),JsonNode.class),400,"INVALID_REQUEST");
                if(path.equals(translations(id))) error(http.exchange(path,method,new HttpEntity<>(null,headers),JsonNode.class),400,"INVALID_REQUEST");
            }
            for(String body:List.of("{","{\"role\":\"TRANSLATOR\"}")) error(request(method,path,body,translator.token()),400,"INVALID_REQUEST");
        }
        error(request(HttpMethod.POST,translations(empty),Map.of(),translator.token()),400,"INVALID_REQUEST");
        for(String method:List.of("POST","PUT")) {
            var headers=new HttpHeaders(); headers.setOrigin(System.getenv("CORS_ALLOWED_ORIGINS").split(",")[0]);
            headers.setAccessControlRequestMethod(HttpMethod.valueOf(method));headers.setAccessControlRequestHeaders(List.of("Authorization","Content-Type"));
            String target=method.equals("PUT")?translations(id)+"/1":translations(id)+"/1/submit";
            var response=http.exchange(target,HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
            assertThat(response.getStatusCode().value()).isEqualTo(200);
            assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(headers.getOrigin());
            assertThat(response.getHeaders().getAccessControlAllowHeaders()).contains("Authorization","Content-Type");
            assertThat(response.getHeaders().getAccessControlAllowCredentials()).isFalse();
        }
        var dead=new DriverManagerDataSource("jdbc:mysql://127.0.0.1:1/unreachable");
        dead.setConnectionProperties(com.mangabridge.bootstrap.translation.TranslationIntegrationTest.connectionProperties());
        var jdbcDead=new JdbcTemplate(dead);jdbcDead.setQueryTimeout(2);
        var service=new TranslationService(new TranslationDao(jdbcDead),new EpisodeDao(jdbcDead),new AssignmentDao(jdbcDead),Clock.systemUTC(),new org.springframework.jdbc.datasource.DataSourceTransactionManager(dead));
        assertThatThrownBy(()->service.listTranslations(user(translator),id)).isInstanceOfSatisfying(TranslationFailure.class,e->{assertThat(e.status).isEqualTo(503);assertThat(e.code).isEqualTo("SERVICE_UNAVAILABLE");});
    }
    private static Properties connectionProperties() {
        var p=new Properties();p.setProperty("user",System.getenv("DB_USERNAME"));p.setProperty("password",System.getenv("DB_PASSWORD"));
        p.setProperty("connectTimeout","2000");p.setProperty("socketTimeout","3000");p.setProperty("sslMode","DISABLED");return p;
    }
    @Test void noOpSourceLeavesDraftAndApprovalUntouchedAndSourceChangePreservesTerminalStates() {
        Identity translator=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER);
        for(String status:List.of("DRAFT","REVIEW_PENDING","APPROVED","REJECTED","INVALIDATED","PUBLISHED","ON_HOLD")) {
            String id=prepared(translator);start(id,translator);save(id,1,draft(1,1,"preserved",2,"text"),translator);
            long version=translationId(id,1);
            if(status.equals("APPROVED")) approved(id,version,reviewer);
            else jdbc.update("UPDATE translation_version SET status=? WHERE id=?",status,version);
            if(Set.of("PUBLISHED","ON_HOLD").contains(status))
                jdbc.update("UPDATE episode SET published_translation_version_id=? WHERE id=?",version,id);
            int oldAudits=jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=?",Integer.class,id);
            var same=source(id,1,2,"원문 😀 ");
            assertThat(same.getStatusCode().value()).isEqualTo(200);
            assertThat(same.getBody().get("changed").booleanValue()).isFalse();
            assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,version)).isEqualTo(status);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=?",Integer.class,id)).isEqualTo(oldAudits);
            assertThat(source(id,1,2,"changed source").getStatusCode().value()).isEqualTo(201);
            String expected=Set.of("DRAFT","REVIEW_PENDING","APPROVED").contains(status)?"INVALIDATED":status;
            assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,version)).isEqualTo(expected);
            assertThat(jdbc.queryForObject("SELECT draft_revision FROM translation_version WHERE id=?",Integer.class,version)).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_block WHERE translation_version_id=?",Integer.class,version)).isEqualTo(2);
            assertThat(domainCount(id,"APPROVAL_INVALIDATED")).isEqualTo(status.equals("APPROVED")?1:0);
            if(status.equals("APPROVED")) {
                assertThat(jdbc.queryForObject("SELECT invalidated_at IS NOT NULL FROM review_decision WHERE translation_version_id=?",Boolean.class,version)).isTrue();
                assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='APPROVAL_INVALIDATED' AND translation_version_id=? AND actor_account_id=? AND source_version=2",Integer.class,id,version,operator.id())).isEqualTo(1);
            }
            if(Set.of("PUBLISHED","ON_HOLD").contains(status))
                assertThat(jdbc.queryForObject("SELECT published_translation_version_id FROM episode WHERE id=?",Long.class,id)).isEqualTo(version);
        }
        String noTranslations=create("source without translations");
        assertThat(source(noTranslations,0,1,"source").getStatusCode().value()).isEqualTo(201);
        assertThat(source(noTranslations,1,1,"changed").getStatusCode().value()).isEqualTo(201);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE episode_id=?",Integer.class,noTranslations)).isZero();
    }
    @Test void auditFailuresRollBackCreationSubmissionAndEntireSourceInvalidation() {
        Identity translator=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER); String id=prepared(translator);
        doThrow(new DataIntegrityViolationException("SECRET fixture failure")).when(dao).audit(anyLong(),eq("TRANSLATION_CREATED"),anyLong(),anyInt(),anyLong(),any());
        error(start(id,translator),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT latest_translation_version FROM episode WHERE id=?",Integer.class,id)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE episode_id=?",Integer.class,id)).isZero();
        assertThat(domainCount(id,"TRANSLATION_CREATED")).isZero(); reset(dao);
        start(id,translator);save(id,1,draft(1,1,"first",2,"second"),translator);
        doThrow(new DataIntegrityViolationException("SECRET fixture failure")).when(dao).audit(anyLong(),eq("TRANSLATION_SUBMITTED"),anyLong(),anyInt(),anyLong(),any());
        error(submit(id,1,2,translator),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,translationId(id,1))).isEqualTo("DRAFT");
        assertThat(jdbc.queryForObject("SELECT submitted_at IS NULL FROM translation_version WHERE id=?",Boolean.class,translationId(id,1))).isTrue();
        assertThat(domainCount(id,"TRANSLATION_SUBMITTED")).isZero(); reset(dao);
        long translation=translationId(id,1); approved(id,translation,reviewer);
        doAnswer(call->{call.callRealMethod();throw new DataIntegrityViolationException("SECRET fixture failure");})
                .when(dao).audit(anyLong(),eq("APPROVAL_INVALIDATED"),anyLong(),anyInt(),anyLong(),any());
        error(source(id,1,2,"will roll back"),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT latest_source_version FROM episode WHERE id=?",Integer.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM episode_source_version WHERE episode_id=?",Integer.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM source_block WHERE episode_id=?",Integer.class,id)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,translation)).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT invalidated_at IS NULL FROM review_decision WHERE translation_version_id=?",Boolean.class,translation)).isTrue();
        assertThat(domainCount(id,"SOURCE_SAVED")).isEqualTo(1);assertThat(domainCount(id,"APPROVAL_INVALIDATED")).isZero(); reset(dao);
        doAnswer(call->{call.callRealMethod();throw new DataIntegrityViolationException("SECRET fixture failure");})
                .when(dao).invalidateOnSourceSave(anyLong(),anyInt(),anyLong(),any());
        error(source(id,1,2,"also rolls back"),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT latest_source_version FROM episode WHERE id=?",Integer.class,id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,translation)).isEqualTo("APPROVED");
        assertThat(domainCount(id,"APPROVAL_INVALIDATED")).isZero();
    }
    @Test void multipleApprovedVersionsEachInvalidateAndCopiedCreationFailureRollsBack() {
        Identity translator=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER);String id=prepared(translator);
        start(id,translator);save(id,1,draft(1,1,"preserved a",2,"preserved b"),translator);
        approved(id,translationId(id,1),reviewer);
        start(id,translator);approved(id,translationId(id,2),reviewer);
        doThrow(new DataIntegrityViolationException("SECRET fixture failure")).when(dao).audit(anyLong(),eq("TRANSLATION_CREATED"),anyLong(),anyInt(),anyLong(),any());
        error(start(id,translator),503,"SERVICE_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT latest_translation_version FROM episode WHERE id=?",Integer.class,id)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE episode_id=?",Integer.class,id)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_block WHERE episode_id=?",Integer.class,id)).isEqualTo(4);
        reset(dao);assertThat(start(id,translator).getStatusCode().value()).isEqualTo(201);
        assertThat(source(id,1,2,"new source").getStatusCode().value()).isEqualTo(201);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE episode_id=? AND status='INVALIDATED'",Integer.class,id)).isEqualTo(3);
        assertThat(domainCount(id,"APPROVAL_INVALIDATED")).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM review_decision WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?) AND invalidated_at IS NOT NULL",Integer.class,id)).isEqualTo(2);
    }
    @Test void concurrentCreationAndDraftSaveHaveExactlyOneWinner() throws Exception {
        Identity translator=identity(Role.TRANSLATOR); String id=prepared(translator);
        var pool=Executors.newFixedThreadPool(2);
        try {
            var gate=new CyclicBarrier(2);
            Callable<Integer> create=()->{gate.await(3,TimeUnit.SECONDS);return start(id,translator).getStatusCode().value();};
            var one=pool.submit(create);var two=pool.submit(create);
            assertThat(List.of(one.get(8,TimeUnit.SECONDS),two.get(8,TimeUnit.SECONDS))).containsExactlyInAnyOrder(201,409);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE episode_id=?",Integer.class,id)).isEqualTo(1);
            assertThat(domainCount(id,"TRANSLATION_CREATED")).isEqualTo(1);
            var saveGate=new CyclicBarrier(2);
            var first=pool.submit(()->{saveGate.await(3,TimeUnit.SECONDS);return save(id,1,draft(1,1,"a"),translator).getStatusCode().value();});
            var second=pool.submit(()->{saveGate.await(3,TimeUnit.SECONDS);return save(id,1,draft(1,1,"b"),translator).getStatusCode().value();});
            assertThat(List.of(first.get(8,TimeUnit.SECONDS),second.get(8,TimeUnit.SECONDS))).containsExactlyInAnyOrder(200,409);
            assertThat(jdbc.queryForObject("SELECT draft_revision FROM translation_version WHERE episode_id=?",Integer.class,id)).isEqualTo(2);
        } finally {pool.shutdownNow();}
    }
    @Test void sourceLockSerializesDraftSaveAndSubmissionAndSubmissionFirstIsInvalidated() throws Exception {
        Identity translator=identity(Role.TRANSLATOR);
        for(boolean submit:List.of(false,true)) {
            String id=prepared(translator);start(id,translator);save(id,1,draft(1,1,"a",2,"b"),translator);
            var sourceHeld=new CountDownLatch(1);var releaseSource=new CountDownLatch(1);var translationReachedLock=new CountDownLatch(1);
            doAnswer(call->{sourceHeld.countDown();if(!releaseSource.await(5,TimeUnit.SECONDS))throw new AssertionError("Fixture lock release timed out");return call.callRealMethod();})
                    .when(sourceDao).audit(anyLong(),eq("SOURCE_SAVED"),eq(Long.parseLong(id)),any(),any());
            var locks=new java.util.concurrent.atomic.AtomicInteger();
            doAnswer(call->{if(locks.incrementAndGet()==2)translationReachedLock.countDown();return call.callRealMethod();})
                    .when(sourceDao).episode(Long.parseLong(id),true);
            var pool=Executors.newFixedThreadPool(2);
            try {
                var source=pool.submit(()->source(id,1,2,"race source"));
                assertThat(sourceHeld.await(4,TimeUnit.SECONDS)).isTrue();
                var translation=pool.submit(()->submit?submit(id,1,2,translator):save(id,1,draft(2,1,"lost"),translator));
                assertThat(translationReachedLock.await(4,TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(()->translation.get(150,TimeUnit.MILLISECONDS)).isInstanceOf(TimeoutException.class);
                releaseSource.countDown();assertThat(source.get(5,TimeUnit.SECONDS).getStatusCode().value()).isEqualTo(201);
                var conflict=translation.get(5,TimeUnit.SECONDS);error(conflict,409,"STATE_CONFLICT");
                assertThat(conflict.getBody().get("error").get("currentStatus").textValue()).isEqualTo("INVALIDATED");
                assertThat(domainCount(id,"TRANSLATION_SUBMITTED")).isZero();
            } finally {releaseSource.countDown();pool.shutdownNow();reset(sourceDao);}
        }
        String id=prepared(translator);start(id,translator);save(id,1,draft(1,1,"a",2,"b"),translator);
        assertThat(submit(id,1,2,translator).getStatusCode().value()).isEqualTo(200);
        assertThat(source(id,1,2,"after submit").getStatusCode().value()).isEqualTo(201);
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,translationId(id,1))).isEqualTo("INVALIDATED");
    }
    private com.mangabridge.bootstrap.auth.AuthModels.CurrentUser user(Identity actor) {
        return new com.mangabridge.bootstrap.auth.AuthModels.CurrentUser(new com.mangabridge.bootstrap.auth.AuthModels.User(Long.toString(actor.id()),"fixture",Role.TRANSLATOR),Instant.now().plusSeconds(3600));
    }
}
