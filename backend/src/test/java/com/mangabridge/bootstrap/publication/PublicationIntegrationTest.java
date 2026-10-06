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
@Import(PublicationIntegrationTest.Fixtures.class)
class PublicationIntegrationTest {
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
        @Bean @Primary TrackingAuthDao publicationTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.pub."+UUID.randomUUID();var key=new GeneratedKeyHolder();
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

    @Test void publicationAndPublicFieldsMatchExactVersionAndAudit() {
        String id=create();
        var before=get("/api/episodes/"+id+"/publication").getBody();
        assertThat(before.get("current").isNull()).isTrue();assertThat(before.get("history").isEmpty()).isTrue();
        long target=version(id,1,1,"APPROVED"," translated \n",true);
        var result=publish(id,1);assertThat(result.getStatusCode().value()).isEqualTo(200);
        assertThat(result.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(result.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","publishedAt");
        assertThat(result.getBody().get("status").textValue()).isEqualTo("PUBLISHED");
        assertThat(result.getBody().get("publishedAt").textValue()).endsWith("Z");
        assertThat(count("publication",id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT published_translation_version_id FROM episode WHERE id=?",Long.class,id)).isEqualTo(target);
        var audit=jdbc.queryForMap("SELECT actor_account_id,source_version,translation_version_id FROM domain_audit WHERE episode_id=? AND event='TRANSLATION_PUBLISHED'",id);
        assertThat(((Number)audit.get("actor_account_id")).longValue()).isEqualTo(users.get(Role.OPERATOR).id());
        assertThat(((Number)audit.get("translation_version_id")).longValue()).isEqualTo(target);assertThat(((Number)audit.get("source_version")).intValue()).isEqualTo(1);
        var publication=get("/api/episodes/"+id+"/publication").getBody();
        assertThat(publication.fieldNames()).toIterable().containsExactlyInAnyOrder("current","history");
        assertThat(publication.get("current").fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","sourceVersion","publishedAt");
        assertThat(publication.get("history").size()).isEqualTo(1);
        var response=publicGet(id);assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        var body=response.getBody();assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("episodeId","title","publishedAt","blocks");
        assertThat(body.get("episodeId").textValue()).isEqualTo(id);assertThat(body.get("title").textValue()).isEqualTo(" public title ");
        assertThat(body.get("publishedAt")).isEqualTo(result.getBody().get("publishedAt"));
        assertThat(body.get("blocks").size()).isEqualTo(2);
        for(int i=0;i<2;i++) {
            var block=body.get("blocks").get(i);assertThat(block.fieldNames()).toIterable().containsExactlyInAnyOrder("seq","pageNo","text");
            assertThat(block.get("seq").intValue()).isEqualTo(i+1);assertThat(block.get("text").textValue()).isEqualTo(" translated \n"+(i+1));
        }
        assertThat(body.get("blocks").get(0).get("pageNo").intValue()).isEqualTo(2);assertThat(body.get("blocks").get(1).get("pageNo").isNull()).isTrue();
        assertThat(body.toString()).doesNotContain("SECRET","APPROVED","PUBLISHED","reviewer","password");
        state(publish(id,1),"PUBLISHED");assertThat(count("publication",id)).isEqualTo(1);
    }
    @Test void allUnapprovedMissingAndInvalidatedDecisionsAreBlocked() {
        String id=create();long target=version(id,1,1,"DRAFT","text",false);
        for(String status:List.of("DRAFT","REVIEW_PENDING","REJECTED","INVALIDATED","ON_HOLD")) {
            jdbc.update("UPDATE translation_version SET status=? WHERE id=?",status,target);state(publish(id,1),status);
        }
        jdbc.update("UPDATE translation_version SET status='APPROVED' WHERE id=?",target);state(publish(id,1),"APPROVED");
        jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at,invalidated_at) VALUES (?,'APPROVED',?,?,?,?)",target,users.get(Role.REVIEWER).id(),1,Timestamp.from(Instant.now()),Timestamp.from(Instant.now()));
        state(publish(id,1),"APPROVED");jdbc.update("UPDATE review_decision SET invalidated_at=NULL WHERE translation_version_id=?",target);
        source(id,1,"changed");state(publish(id,1),"INVALIDATED");
        jdbc.update("UPDATE translation_version SET status='APPROVED' WHERE id=?",target);jdbc.update("UPDATE review_decision SET invalidated_at=NULL WHERE translation_version_id=?",target);
        state(publish(id,1),"APPROVED");assertThat(count("publication",id)).isZero();
        assertThat(jdbc.queryForObject("SELECT published_translation_version_id FROM episode WHERE id=?",Long.class,id)).isNull();
        error(publicGet(id),404,"NOT_FOUND");
    }
    @Test void publicSnapshotSurvivesDraftPendingApprovalSourceChangesAndReplacementHistory() {
        String id=create();long first=version(id,1,1,"APPROVED","first",true);publish(id,1);
        var snapshot=publicGet(id).getBody();long next=version(id,2,1,"DRAFT","second",false);
        assertThat(publicGet(id).getBody()).isEqualTo(snapshot);
        jdbc.update("UPDATE translation_version SET status='REVIEW_PENDING' WHERE id=?",next);assertThat(publicGet(id).getBody()).isEqualTo(snapshot);
        jdbc.update("UPDATE translation_version SET status='APPROVED' WHERE id=?",next);
        jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) VALUES (?,'APPROVED',?,?,?)",next,users.get(Role.REVIEWER).id(),1,Timestamp.from(Instant.now()));
        assertThat(publicGet(id).getBody()).isEqualTo(snapshot);publish(id,2);
        assertThat(publicGet(id).getBody().get("blocks").get(0).get("text").textValue()).isEqualTo("second1");
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,first)).isEqualTo("PUBLISHED");
        var publication=get("/api/episodes/"+id+"/publication").getBody();
        assertThat(publication.get("current").get("versionNo").intValue()).isEqualTo(2);
        assertThat(publication.get("history").get(0).get("versionNo").intValue()).isEqualTo(2);assertThat(publication.get("history").get(1).get("versionNo").intValue()).isEqualTo(1);
        var replaced=publicGet(id).getBody();source(id,1,"new-source");assertThat(publicGet(id).getBody()).isEqualTo(replaced);
        assertThat(jdbc.queryForObject("SELECT published_translation_version_id FROM episode WHERE id=?",Long.class,id)).isEqualTo(next);
    }
    @Test void olderApprovedVersionMayReplaceNewerPublication() {
        String id=create();version(id,1,1,"APPROVED","older",true);version(id,2,1,"APPROVED","newer",true);
        assertThat(publish(id,2).getStatusCode().value()).isEqualTo(200);assertThat(publish(id,1).getStatusCode().value()).isEqualTo(200);
        assertThat(get("/api/episodes/"+id+"/publication").getBody().get("current").get("versionNo").intValue()).isEqualTo(1);
        assertThat(publicGet(id).getBody().get("blocks").get(0).get("text").textValue()).isEqualTo("older1");
    }
    @Test void auditFaultRollsBackStatePublicationAndPreviousPointer() {
        String id=create();version(id,1,1,"APPROVED","first",true);publish(id,1);
        long next=version(id,2,1,"APPROVED","next",true);var previous=get("/api/episodes/"+id+"/publication").getBody();
        doThrow(new DataAccessResourceFailureException("SECRET audit fault")).when(dao).audit(anyLong(),anyLong(),anyInt(),anyLong(),any());
        error(publish(id,2),503,"SERVICE_UNAVAILABLE");
        assertThat(get("/api/episodes/"+id+"/publication").getBody()).isEqualTo(previous);
        assertThat(jdbc.queryForObject("SELECT status FROM translation_version WHERE id=?",String.class,next)).isEqualTo("APPROVED");assertThat(count("publication",id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='TRANSLATION_PUBLISHED'",Integer.class,id)).isEqualTo(1);
        doThrow(new DataAccessResourceFailureException("SECRET database fault")).when(dao).count();
        error(call(HttpMethod.GET,"/api/public/episodes",null,"invalid"),503,"SERVICE_UNAVAILABLE");
    }
    @Test void simultaneousSameVersionPublishingHasExactlyOneWinner() throws Exception {
        String id=create();version(id,1,1,"APPROVED","text",true);var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try {
            Callable<ResponseEntity<JsonNode>> work=()->{start.await();return publish(id,1);};var a=pool.submit(work);var b=pool.submit(work);start.countDown();
            var results=List.of(a.get(30,TimeUnit.SECONDS),b.get(30,TimeUnit.SECONDS));
            assertThat(results.stream().map(r->r.getStatusCode().value()).toList()).containsExactlyInAnyOrder(200,409);
            state(results.stream().filter(r->r.getStatusCode().value()==409).findFirst().orElseThrow(),"PUBLISHED");
            assertThat(count("publication",id)).isEqualTo(1);assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='TRANSLATION_PUBLISHED'",Integer.class,id)).isEqualTo(1);
        } finally {pool.shutdownNow();}
    }
    @Test void rolesForgeryUnauthenticatedAndPublicTokensAreIndependent() {
        String id=create();version(id,1,1,"APPROVED","text",true);
        for(Role role:Role.values()) {
            String token=users.get(role).token();
            for(String path:List.of(publishPath(id,1),"/api/episodes/"+id+"/publication")) {
                var result=call(path.endsWith("publish")?HttpMethod.POST:HttpMethod.GET,path,null,token);
                if(role==Role.OPERATOR) assertThat(result.getStatusCode().value()).isEqualTo(200);else error(result,403,"FORBIDDEN");
            }
            assertThat(publicGet(id).getBody()).isEqualTo(call(HttpMethod.GET,"/api/public/episodes/"+id,null,token).getBody());
        }
        error(call(HttpMethod.POST,publishPath(id,1),null,null),401,"AUTH_REQUIRED");error(call(HttpMethod.GET,"/api/episodes/"+id+"/publication",null,null),401,"AUTH_REQUIRED");
        var headers=new HttpHeaders();headers.setBearerAuth(users.get(Role.READER).token());headers.set("X-Role","OPERATOR");headers.set("X-User-Id",Long.toString(users.get(Role.OPERATOR).id()));
        error(http.exchange(publishPath(id,1),HttpMethod.POST,new HttpEntity<>(headers),JsonNode.class),403,"FORBIDDEN");
        error(call(HttpMethod.POST,publishPath(id,1),Map.of("role","OPERATOR"),users.get(Role.OPERATOR).token()),400,"INVALID_REQUEST");
        var snapshot=publicGet(id).getBody();jdbc.update("UPDATE auth_token SET expires_at=? WHERE account_id=?",Timestamp.from(Instant.now().minusSeconds(10)),users.get(Role.READER).id());
        for(String token:List.of(users.get(Role.READER).token(),"invalid","a".repeat(43))) {
            var response=call(HttpMethod.GET,"/api/public/episodes/"+id,null,token);assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getBody()).isEqualTo(snapshot);
        }
        headers=new HttpHeaders();headers.set("Authorization","Basic invalid");assertThat(http.exchange("/api/public/episodes/"+id,HttpMethod.GET,new HttpEntity<>(headers),JsonNode.class).getBody()).isEqualTo(snapshot);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Integer.class,users.get(Role.TRANSLATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id())).isEqualTo(7);
    }
    @Test void publicListPagingOnlyPublishedAndIdenticalNotFound() {
        String hidden=create();version(hidden,1,1,"APPROVED","hidden",true);
        error(publicGet(hidden),404,"NOT_FOUND");assertThat(publicGet(hidden).getBody()).isEqualTo(publicGet("999999999999999999").getBody());
        String a=create(),b=create();version(a,1,1,"APPROVED","a",true);version(b,1,1,"APPROVED","b",true);publish(b,1);publish(a,1);
        var body=call(HttpMethod.GET,"/api/public/episodes",null,null).getBody();
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("items","total");assertThat(body.get("total").intValue()).isEqualTo(2);
        assertThat(body.get("items").get(0).get("episodeId").textValue()).isEqualTo(a);assertThat(body.get("items").get(1).get("episodeId").textValue()).isEqualTo(b);
        assertThat(body.get("items").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("episodeId","title","publishedAt");
        assertThat(call(HttpMethod.GET,"/api/public/episodes?limit=1&offset=1",null,null).getBody().get("items").get(0).get("episodeId").textValue()).isEqualTo(b);
        assertThat(call(HttpMethod.GET,"/api/public/episodes?limit=100&offset=9999999999999999999999",null,null).getBody().get("items").isEmpty()).isTrue();
        for(String query:List.of("limit=0","limit=101","limit=abc","limit=","offset=-1","offset=abc","offset=")) error(call(HttpMethod.GET,"/api/public/episodes?"+query,null,null),400,"INVALID_REQUEST");
        assertThat(call(HttpMethod.GET,"/api/public/episodes?limit=1&offset=2",null,null).getBody().get("items").isEmpty()).isTrue();
    }
    @Test void invalidPathsBodiesMethodsAndCorsKeepSafeErrors() {
        String id=create();version(id,1,1,"APPROVED","text",true);
        for(String bad:List.of("0","01","-1","abc","1000000000000000000")) {
            error(publicGet(bad),404,"NOT_FOUND");error(get("/api/episodes/"+bad+"/publication"),404,"NOT_FOUND");error(publish(bad,1),404,"NOT_FOUND");
        }
        for(String bad:List.of("0","01","-1","abc","1000000000")) error(call(HttpMethod.POST,"/api/episodes/"+id+"/translations/"+bad+"/publish",null,users.get(Role.OPERATOR).token()),404,"NOT_FOUND");
        error(publish("999999999999999999",1),404,"NOT_FOUND");error(publish(id,99),404,"NOT_FOUND");error(get("/api/episodes/999999999999999999/publication"),404,"NOT_FOUND");
        for(Object body:List.of(Map.of(),Map.of("role","OPERATOR"),"{")) error(call(HttpMethod.POST,publishPath(id,1),body,users.get(Role.OPERATOR).token()),400,"INVALID_REQUEST");
        for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
            var headers=new HttpHeaders();headers.setContentType(type);headers.setBearerAuth(users.get(Role.OPERATOR).token());
            error(http.exchange(publishPath(id,1),HttpMethod.POST,new HttpEntity<>("body",headers),JsonNode.class),400,"INVALID_REQUEST");
        }
        for(HttpMethod method:List.of(HttpMethod.POST,HttpMethod.PUT,HttpMethod.DELETE)) {
            for(String path:List.of("/api/public/episodes","/api/public/episodes/"+id)) {
                var response=call(method,path,null,"malformed");assertThat(response.getStatusCode().value()).isEqualTo(405);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");assertThat(response.getBody().get("error").get("code").textValue()).isEqualTo("METHOD_NOT_ALLOWED");
            }
        }
        var headers=new HttpHeaders();headers.setOrigin("http://localhost:3000");headers.setAccessControlRequestMethod(HttpMethod.POST);headers.setAccessControlRequestHeaders(List.of("Authorization","Content-Type"));
        var cors=http.exchange(publishPath(id,1),HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
        assertThat(cors.getStatusCode().value()).isEqualTo(200);assertThat(cors.getHeaders().getAccessControlAllowOrigin()).isEqualTo("http://localhost:3000");assertThat(cors.getHeaders().getAccessControlAllowHeaders()).contains("Authorization","Content-Type");
        headers.setOrigin("https://unapproved.example");assertThat(http.exchange("/api/public/episodes",HttpMethod.GET,new HttpEntity<>(headers),String.class).getStatusCode().value()).isEqualTo(403);
    }
}
