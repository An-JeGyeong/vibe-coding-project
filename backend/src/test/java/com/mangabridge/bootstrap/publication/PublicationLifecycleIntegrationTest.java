package com.mangabridge.bootstrap.publication;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(PublicationLifecycleIntegrationTest.Fixtures.class)
class PublicationLifecycleIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @MockitoSpyBean PublicationDao dao;
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao publicationLifecycleTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.lifecycle."+UUID.randomUUID();var key=new GeneratedKeyHolder();
            jdbc.update(connection->{
                var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
                statement.setString(1,login);statement.setString(2,"publication fixture");statement.setString(3,role.name());statement.setString(4,encoder.encode(password));return statement;
            },key);
            long id=key.getKey().longValue();
            byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);
            String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            users.put(role,new Identity(id,token));
            jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",digest(token),id,Timestamp.from(Instant.now().plusSeconds(3600)));
        }
    }
    private static byte[] digest(String token) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch(java.security.NoSuchAlgorithmException failure) { throw new AssertionError(failure); }
    }
    @AfterEach void cleanup() {
        reset(dao);tracking.cleanupAudits();
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
        for(var user:users.values()) {
            jdbc.update("DELETE FROM auth_token WHERE account_id=?",user.id());
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?",user.id());
            jdbc.update("DELETE FROM demo_account WHERE id=?",user.id());
        }
    }
    private ResponseEntity<JsonNode> call(HttpMethod method,String path,Object body,String token) {
        var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);
        if(token!=null) headers.setBearerAuth(token);
        return http.exchange(path,method,new HttpEntity<>(body,headers),JsonNode.class);
    }
    private ResponseEntity<JsonNode> get(String path) { return call(HttpMethod.GET,path,null,users.get(Role.OPERATOR).token()); }
    private ResponseEntity<JsonNode> publicGet(String id) { return call(HttpMethod.GET,"/api/public/episodes/"+id,null,null); }
    private String create() {
        var response=call(HttpMethod.POST,"/api/episodes",Map.of("title"," public title "),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        String id=response.getBody().get("id").textValue();episodes.add(id);
        source(id,0,"SECRET_SOURCE");return id;
    }
    private void source(String id,int expected,String prefix) {
        var response=call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",expected,"blocks",List.of(Map.of("pageNo",2,"text",prefix+"1"),Map.of("text",prefix+"2"))),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
    }
    private long version(String id,int number,int source,String status,String text,boolean decision) {
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at,submitted_at) VALUES (?,?,?,?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1,Long.parseLong(id));statement.setInt(2,number);statement.setInt(3,source);statement.setString(4,status);
            statement.setLong(5,users.get(Role.TRANSLATOR).id());statement.setTimestamp(6,Timestamp.from(Instant.now()));statement.setTimestamp(7,Timestamp.from(Instant.now()));return statement;
        },key);
        long version=key.getKey().longValue();
        for(int seq=1;seq<=2;seq++) jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,?,?,?)",version,id,source,seq,text+seq);
        jdbc.update("UPDATE episode SET latest_translation_version=? WHERE id=?",number,id);
        if(decision) jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) VALUES (?,'APPROVED',?,?,?)",version,users.get(Role.REVIEWER).id(),source,Timestamp.from(Instant.now()));
        return version;
    }
    private String publishPath(String id,int number) { return "/api/episodes/"+id+"/translations/"+number+"/publish"; }
    private ResponseEntity<JsonNode> publish(String id,int number) { return call(HttpMethod.POST,publishPath(id,number),null,users.get(Role.OPERATOR).token()); }
    private int count(String table,String id) { return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE episode_id=?",Integer.class,id); }
    private void error(ResponseEntity<JsonNode> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        var body=response.getBody();assertThat(body.fieldNames()).toIterable().containsExactly("error");
        assertThat(body.get("error").fieldNames()).toIterable().isSubsetOf("code","message","currentStatus");
        assertThat(body.get("error").get("code").textValue()).isEqualTo(code);
        assertThat(body.get("error").get("message").textValue()).isNotBlank();
        assertThat(body.toString()).doesNotContain("SECRET",password,"Exception","jdbc:","password_hash");
        for(var user:users.values()) assertThat(body.toString()).doesNotContain(user.token());
    }
    private void state(ResponseEntity<JsonNode> response,String state) { error(response,409,"STATE_CONFLICT");assertThat(response.getBody().get("error").get("currentStatus").textValue()).isEqualTo(state); }

    private String path(String id,String action) { return "/api/episodes/"+id+"/publication/"+action; }
    private ResponseEntity<JsonNode> action(String id,String action) { return call(HttpMethod.POST,path(id,action),null,users.get(Role.OPERATOR).token()); }
    private JsonNode publication(String id) { return get("/api/episodes/"+id+"/publication").getBody(); }
    private long pointer(String id) { return jdbc.queryForObject("SELECT published_translation_version_id FROM episode WHERE id=?",Long.class,id); }
    private String status(long version) { return jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,version); }
    private int audits(String id,String event) { return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event=?",Integer.class,id,event); }
    private void assertAudit(String id,long version,String event,JsonNode time) {
        var audit=jdbc.queryForMap("SELECT actor_account_id,source_version,translation_version_id FROM domain_audit WHERE episode_id=? AND event=?",id,event);
        assertThat(((Number)audit.get("actor_account_id")).longValue()).isEqualTo(users.get(Role.OPERATOR).id());
        assertThat(((Number)audit.get("source_version")).intValue()).isEqualTo(1);
        assertThat(((Number)audit.get("translation_version_id")).longValue()).isEqualTo(version);
        Instant occurredAt=jdbc.queryForObject("SELECT occurred_at FROM domain_audit WHERE episode_id=? AND event=?",(rs,n)->rs.getTimestamp(1).toInstant(),id,event);
        assertThat(occurredAt).isEqualTo(Instant.parse(time.textValue()));
    }
    @Test void holdAndResumePreservePointerAndExposeOnlyOneCurrentOrHeldEntry() {
        String id=create();var initial=publication(id);
        assertThat(initial.fieldNames()).toIterable().containsExactlyInAnyOrder("current","held","history");
        assertThat(initial.get("current").isNull()).isTrue();assertThat(initial.get("held").isNull()).isTrue();assertThat(initial.get("history").isEmpty()).isTrue();
        long target=version(id,1,1,"APPROVED","same text\n",true);var first=publish(id,1).getBody();var original=publicGet(id).getBody();
        var published=publication(id);assertThat(published.get("current").get("publishedAt")).isEqualTo(first.get("publishedAt"));assertThat(published.get("held").isNull()).isTrue();
        var held=action(id,"hold");assertThat(held.getStatusCode().value()).isEqualTo(200);assertThat(held.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(held.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","heldAt");
        assertThat(held.getBody().get("versionNo").intValue()).isEqualTo(1);assertThat(held.getBody().get("status").textValue()).isEqualTo("ON_HOLD");assertThat(held.getBody().get("heldAt").textValue()).endsWith("Z");
        assertThat(status(target)).isEqualTo("ON_HOLD");assertThat(pointer(id)).isEqualTo(target);assertThat(count("publication",id)).isEqualTo(1);
        assertAudit(id,target,"PUBLICATION_HELD",held.getBody().get("heldAt"));
        var snapshot=publication(id);assertThat(snapshot.get("current").isNull()).isTrue();assertThat(snapshot.get("held")).isEqualTo(published.get("current"));assertThat(snapshot.get("history")).isEqualTo(published.get("history"));
        assertThat(snapshot.get("held").fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","sourceVersion","publishedAt");
        var hidden=publicGet(id);error(hidden,404,"NOT_FOUND");assertThat(hidden.getBody()).isEqualTo(publicGet("999999999999999999").getBody());
        var list=call(HttpMethod.GET,"/api/public/episodes",null,null).getBody();assertThat(list.get("items").isEmpty()).isTrue();assertThat(list.get("total").intValue()).isZero();
        var resumed=action(id,"resume");assertThat(resumed.getStatusCode().value()).isEqualTo(200);assertThat(resumed.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(resumed.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","publishedAt");
        assertThat(resumed.getBody().get("versionNo").intValue()).isEqualTo(1);assertThat(resumed.getBody().get("status").textValue()).isEqualTo("PUBLISHED");
        assertThat(Instant.parse(resumed.getBody().get("publishedAt").textValue())).isAfter(Instant.parse(first.get("publishedAt").textValue()));
        assertThat(status(target)).isEqualTo("PUBLISHED");assertThat(pointer(id)).isEqualTo(target);assertThat(count("publication",id)).isEqualTo(2);
        assertAudit(id,target,"PUBLICATION_RESUMED",resumed.getBody().get("publishedAt"));
        var result=publication(id);assertThat(result.get("held").isNull()).isTrue();assertThat(result.get("history").size()).isEqualTo(2);
        assertThat(result.get("current")).isEqualTo(result.get("history").get(0));assertThat(result.get("history").get(0).get("publishedAt")).isEqualTo(resumed.getBody().get("publishedAt"));assertThat(result.get("history").get(1).get("publishedAt")).isEqualTo(first.get("publishedAt"));
        var visible=publicGet(id).getBody();assertThat(visible.get("blocks")).isEqualTo(original.get("blocks"));assertThat(visible.get("title")).isEqualTo(original.get("title"));assertThat(visible.get("publishedAt")).isEqualTo(resumed.getBody().get("publishedAt"));
        assertThat(call(HttpMethod.GET,"/api/public/episodes",null,null).getBody().get("items").get(0).get("publishedAt")).isEqualTo(resumed.getBody().get("publishedAt"));
        assertThat(action(id,"hold").getStatusCode().value()).isEqualTo(200);assertThat(publication(id).get("held").get("publishedAt")).isEqualTo(resumed.getBody().get("publishedAt"));assertThat(count("publication",id)).isEqualTo(2);
    }
    @Test void absentPointerAndRepeatedOperationsAreSafeStateConflicts() {
        String id=create();for(String action:List.of("hold","resume")) {var result=action(id,action);error(result,409,"STATE_CONFLICT");assertThat(result.getBody().get("error").fieldNames()).toIterable().containsExactlyInAnyOrder("code","message");}
        long target=version(id,1,1,"APPROVED","text",true);publish(id,1);state(action(id,"resume"),"PUBLISHED");
        action(id,"hold");state(action(id,"hold"),"ON_HOLD");state(publish(id,1),"ON_HOLD");
        assertThat(count("publication",id)).isEqualTo(1);assertThat(pointer(id)).isEqualTo(target);assertThat(audits(id,"PUBLICATION_HELD")).isEqualTo(1);assertThat(audits(id,"PUBLICATION_RESUMED")).isZero();
    }
    @Test void resumeIgnoresLatestSourceAndKeepsOriginalPublishedContent() {
        String id=create();long target=version(id,1,1,"APPROVED","old text",true);publish(id,1);var original=publicGet(id).getBody();action(id,"hold");
        source(id,1,"changed source");assertThat(status(target)).isEqualTo("ON_HOLD");assertThat(pointer(id)).isEqualTo(target);
        assertThat(jdbc.queryForObject("SELECT invalidated_at FROM review_decision WHERE translation_version_id=?",Timestamp.class,target)).isNull();
        assertThat(action(id,"resume").getStatusCode().value()).isEqualTo(200);
        assertThat(publicGet(id).getBody().get("blocks")).isEqualTo(original.get("blocks"));assertThat(publication(id).get("current").get("sourceVersion").intValue()).isEqualTo(1);
        assertThat(audits(id,"APPROVAL_INVALIDATED")).isZero();assertThat(status(target)).isEqualTo("PUBLISHED");
        source(id,2,"another source");assertThat(status(target)).isEqualTo("PUBLISHED");assertThat(pointer(id)).isEqualTo(target);
    }
    @Test void publishingAnotherApprovedVersionReplacesHeldPointerWithoutResumingOldVersion() {
        String id=create();long old=version(id,1,1,"APPROVED","old",true);publish(id,1);action(id,"hold");state(publish(id,1),"ON_HOLD");
        long next=version(id,2,1,"APPROVED","new",true);assertThat(publish(id,2).getStatusCode().value()).isEqualTo(200);
        assertThat(pointer(id)).isEqualTo(next);assertThat(status(old)).isEqualTo("ON_HOLD");assertThat(status(next)).isEqualTo("PUBLISHED");
        assertThat(publicGet(id).getBody().get("blocks").get(0).get("text").textValue()).isEqualTo("new1");assertThat(publication(id).get("held").isNull()).isTrue();
        assertThat(publication(id).get("history").size()).isEqualTo(2);state(action(id,"resume"),"PUBLISHED");assertThat(audits(id,"PUBLICATION_RESUMED")).isZero();
    }
    @Test void concurrentHoldAndResumeHaveOneWinnerEach() throws Exception {
        String id=create();long target=version(id,1,1,"APPROVED","text",true);publish(id,1);
        for(String action:List.of("hold","resume")) {
            var pool=Executors.newFixedThreadPool(4);var start=new CountDownLatch(1);
            try {List<Future<ResponseEntity<JsonNode>>> futures=new ArrayList<>();for(int i=0;i<4;i++) futures.add(pool.submit(()->{start.await();return action(id,action);}));start.countDown();
                List<ResponseEntity<JsonNode>> results=new ArrayList<>();for(var future:futures) results.add(future.get(30,TimeUnit.SECONDS));
                assertThat(results.stream().map(r->r.getStatusCode().value()).toList()).containsExactlyInAnyOrder(200,409,409,409);
                for(var result:results) if(result.getStatusCode().value()==409) state(result,action.equals("hold")?"ON_HOLD":"PUBLISHED");
            } finally {pool.shutdownNow();}
        }
        assertThat(pointer(id)).isEqualTo(target);assertThat(count("publication",id)).isEqualTo(2);assertThat(audits(id,"PUBLICATION_HELD")).isEqualTo(1);assertThat(audits(id,"PUBLICATION_RESUMED")).isEqualTo(1);
    }
    @Test void auditFailuresRollBackBothLifecycleTransactions() {
        String id=create();long target=version(id,1,1,"APPROVED","text",true);publish(id,1);var initial=publication(id);
        doThrow(new DataAccessResourceFailureException("SECRET audit fault")).when(dao).lifecycleAudit(anyLong(),anyString(),anyLong(),anyInt(),anyLong(),any());
        error(action(id,"hold"),503,"SERVICE_UNAVAILABLE");assertThat(status(target)).isEqualTo("PUBLISHED");assertThat(pointer(id)).isEqualTo(target);assertThat(count("publication",id)).isEqualTo(1);assertThat(publication(id)).isEqualTo(initial);assertThat(audits(id,"PUBLICATION_HELD")).isZero();
        reset(dao);action(id,"hold");var held=publication(id);
        doThrow(new DataAccessResourceFailureException("SECRET audit fault")).when(dao).lifecycleAudit(anyLong(),anyString(),anyLong(),anyInt(),anyLong(),any());
        error(action(id,"resume"),503,"SERVICE_UNAVAILABLE");assertThat(status(target)).isEqualTo("ON_HOLD");assertThat(pointer(id)).isEqualTo(target);assertThat(count("publication",id)).isEqualTo(1);assertThat(publication(id)).isEqualTo(held);assertThat(audits(id,"PUBLICATION_RESUMED")).isZero();
    }
    @Test void roleMatrixForgeryAndUnauthenticatedRequestsCannotChangePublication() {
        String id=create();version(id,1,1,"APPROVED","text",true);publish(id,1);
        for(Role role:Role.values()) for(String action:List.of("hold","resume")) {
            var response=call(HttpMethod.POST,path(id,action),null,users.get(role).token());
            if(role==Role.OPERATOR) assertThat(response.getStatusCode().value()).isEqualTo(200);else error(response,403,"FORBIDDEN");
        }
        for(String action:List.of("hold","resume")) {
            error(call(HttpMethod.POST,path(id,action),null,null),401,"AUTH_REQUIRED");
            var headers=new HttpHeaders();headers.setBearerAuth(users.get(Role.READER).token());headers.set("X-Role","OPERATOR");headers.set("X-User-Id",Long.toString(users.get(Role.OPERATOR).id()));
            error(http.exchange(path(id,action),HttpMethod.POST,new HttpEntity<>(headers),JsonNode.class),403,"FORBIDDEN");
            error(call(HttpMethod.POST,path(id,action),Map.of("role","OPERATOR"),users.get(Role.READER).token()),403,"FORBIDDEN");
        }
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Integer.class,users.get(Role.TRANSLATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id())).isEqualTo(10);
        assertThat(count("publication",id)).isEqualTo(2);assertThat(audits(id,"PUBLICATION_HELD")).isEqualTo(1);assertThat(audits(id,"PUBLICATION_RESUMED")).isEqualTo(1);
    }
    @Test void pathsBodiesMediaTypesAndCorsKeepExistingErrorContract() {
        String id=create();version(id,1,1,"APPROVED","text",true);publish(id,1);
        for(String action:List.of("hold","resume")) {
            for(String bad:List.of("0","01","-1","abc","1000000000000000000","999999999999999999")) error(action(bad,action),404,"NOT_FOUND");
            for(Object body:List.of(Map.of(),Map.of("role","OPERATOR"),"{","null"," ")) error(call(HttpMethod.POST,path(id,action),body,users.get(Role.OPERATOR).token()),400,"INVALID_REQUEST");
            for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
                var headers=new HttpHeaders();headers.setContentType(type);headers.setBearerAuth(users.get(Role.OPERATOR).token());
                error(http.exchange(path(id,action),HttpMethod.POST,new HttpEntity<>("body",headers),JsonNode.class),400,"INVALID_REQUEST");
                error(http.exchange(path(id,action),HttpMethod.POST,new HttpEntity<>(headers),JsonNode.class),400,"INVALID_REQUEST");
            }
            var headers=new HttpHeaders();headers.setOrigin("http://localhost:3000");headers.setAccessControlRequestMethod(HttpMethod.POST);headers.setAccessControlRequestHeaders(List.of("Authorization","Content-Type"));
            var cors=http.exchange(path(id,action),HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);assertThat(cors.getStatusCode().value()).isEqualTo(200);assertThat(cors.getHeaders().getAccessControlAllowOrigin()).isEqualTo("http://localhost:3000");assertThat(cors.getHeaders().getAccessControlAllowHeaders()).contains("Authorization","Content-Type");
        }
        assertThat(count("publication",id)).isEqualTo(1);assertThat(audits(id,"PUBLICATION_HELD")).isZero();assertThat(audits(id,"PUBLICATION_RESUMED")).isZero();
    }
}
