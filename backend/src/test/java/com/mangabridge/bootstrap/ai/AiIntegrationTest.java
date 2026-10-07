package com.mangabridge.bootstrap.ai;

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
@Import(AiIntegrationTest.Fixtures.class)
class AiIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @MockitoSpyBean com.mangabridge.bootstrap.translation.TranslationDao dao;
    @MockitoSpyBean AiAdapter adapter;
    @Autowired org.springframework.core.env.ConfigurableEnvironment environment;
    private final Map<String,Object> configuration=new HashMap<>();
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao aiTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        configuration.put("AI_PROVIDER","mock");configuration.put("AI_API_KEY","");
        environment.getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("ai-fixture",configuration));
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.ai."+UUID.randomUUID();var key=new GeneratedKeyHolder();
            jdbc.update(connection->{
                var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
                statement.setString(1,login);statement.setString(2,"ai fixture");statement.setString(3,role.name());statement.setString(4,encoder.encode(password));return statement;
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
        reset(dao,adapter);environment.getPropertySources().remove("ai-fixture");tracking.cleanupAudits();
        for(String id:episodes) {
            jdbc.update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?",id);
            jdbc.update("DELETE FROM publication WHERE episode_id=?",id);
            jdbc.update("DELETE FROM review_block_comment WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);
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
            jdbc.update("DELETE FROM domain_audit WHERE actor_account_id=?",user.id());
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
        var response=call(HttpMethod.POST,"/api/episodes",Map.of("title"," history title "),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        String id=response.getBody().get("id").textValue();episodes.add(id);
        source(id,0,"SECRET_SOURCE");return id;
    }
    private void source(String id,int expected,String prefix) {
        var response=call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",expected,"blocks",List.of(Map.of("pageNo",2,"text",prefix+"1"),Map.of("text",prefix+"2"))),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
    }
    private String start() {
        String id=create();
        assertThat(call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/translator",Map.of("accountId",Long.toString(users.get(Role.TRANSLATOR).id())),users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(201);
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(201);
        clearInvocations(adapter);return id;
    }
    private String path(String id) { return "/api/my/episodes/"+id+"/translations/1/ai-draft"; }
    private ResponseEntity<JsonNode> request(String id) { return call(HttpMethod.POST,path(id),null,users.get(Role.TRANSLATOR).token()); }
    private long audits(String id) { return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='AI_DRAFT_REQUESTED'",Long.class,id); }
    private List<Map<String,Object>> snapshot(String id) { return jdbc.queryForList("SELECT * FROM translation_version WHERE episode_id=? ORDER BY id",id); }
    private List<Map<String,Object>> texts(String id) { return jdbc.queryForList("SELECT * FROM translation_block WHERE episode_id=? ORDER BY source_seq",id); }
    private void error(ResponseEntity<JsonNode> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getBody().path("error").path("code").asText()).isEqualTo(code);
        assertThat(response.getBody().toString()).doesNotContain("Exception","stackTrace","SECRET","test-key-not-real",password,"jdbc:");
        for(var user:users.values()) assertThat(response.getBody().toString()).doesNotContain(user.token());
    }
    @Test void emptyBlocksOnlySuggestionsPreserveDataAndAuditIsCommittedBeforeProviderIo() {
        String id=start();
        long version=jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=?",Long.class,id);
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,1,1,'already saved')",version,id);
        var before=snapshot(id);var beforeText=texts(id);
        doAnswer(invocation->{assertThat(audits(id)).isEqualTo(1);return invocation.callRealMethod();}).when(adapter).generate(anyList());
        var response=request(id);assertThat(response.getStatusCode().value()).isEqualTo(200);
        var body=response.getBody();assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","provider","suggestions");
        assertThat(body.path("provider").asText()).isEqualTo("mock");assertThat(body.path("versionNo").intValue()).isEqualTo(1);
        assertThat(body.path("suggestions").size()).isEqualTo(1);
        var suggestion=body.path("suggestions").get(0);assertThat(suggestion.fieldNames()).toIterable().containsExactlyInAnyOrder("seq","text");
        assertThat(suggestion.path("seq").intValue()).isEqualTo(2);assertThat(suggestion.path("text").asText()).isEqualTo("[AI 초안] SECRET_SOURCE2");
        assertThat(snapshot(id)).isEqualTo(before);assertThat(texts(id)).isEqualTo(beforeText);
        var audit=jdbc.queryForMap("SELECT * FROM domain_audit WHERE episode_id=? AND event='AI_DRAFT_REQUESTED'",id);
        assertThat(audit.get("actor_account_id")).isEqualTo(users.get(Role.TRANSLATOR).id());assertThat(audit.get("translation_version_id")).isEqualTo(version);
        assertThat(audit.get("source_version")).isEqualTo(1);assertThat(audit.toString()).doesNotContain("SECRET_SOURCE","[AI 초안]",password);
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
    }
    @Test void whitespaceCountsAsEmptyAndAtMostFirstFiftySourceBlocksAreSent() {
        String id=create();var blocks=new ArrayList<Map<String,Object>>();for(int i=1;i<=55;i++) blocks.add(Map.of("text","source "+i));
        assertThat(call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",1,"blocks",blocks),users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(201);
        call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/translator",Map.of("accountId",Long.toString(users.get(Role.TRANSLATOR).id())),users.get(Role.OPERATOR).token());
        call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token());
        long version=jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=?",Long.class,id);
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,2,1,?)",version,id," \t\n\u00a0");
        var before=snapshot(id);var beforeText=texts(id);var response=request(id);
        assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getBody().path("suggestions").size()).isEqualTo(50);
        for(int i=0;i<50;i++) assertThat(response.getBody().path("suggestions").get(i).path("seq").intValue()).isEqualTo(i+1);
        assertThat(snapshot(id)).isEqualTo(before);assertThat(texts(id)).isEqualTo(beforeText);
        verify(adapter).generate(argThat(list->list.size()==50&&list.get(0).seq()==1&&list.get(49).seq()==50));
    }
    @Test void noEmptyBlocksDoesNotCallProviderOrAuditEvenWithoutAnthropicKey() {
        String id=start();
        assertThat(call(HttpMethod.PUT,"/api/my/episodes/"+id+"/translations/1",Map.of("expectedRevision",1,"blocks",List.of(Map.of("seq",1,"text","one"),Map.of("seq",2,"text","two"))),users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(200);
        configuration.put("AI_PROVIDER","anthropic");var before=snapshot(id);var response=request(id);
        assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getBody().path("provider").asText()).isEqualTo("anthropic");
        assertThat(response.getBody().path("suggestions").isEmpty()).isTrue();assertThat(audits(id)).isZero();verifyNoInteractions(adapter);assertThat(snapshot(id)).isEqualTo(before);
    }
    @Test void stateAndCurrentSourceAreRequiredWithoutCallingProvider() {
        String id=start();
        for(String state:List.of("REVIEW_PENDING","REJECTED","APPROVED","PUBLISHED","ON_HOLD","INVALIDATED")) {
            jdbc.update("UPDATE translation_version SET status=? WHERE episode_id=?",state,id);
            var response=request(id);error(response,409,"STATE_CONFLICT");assertThat(response.getBody().path("error").path("currentStatus").asText()).isEqualTo(state);
        }
        jdbc.update("UPDATE translation_version SET status='DRAFT' WHERE episode_id=?",id);
        source(id,1,"new source");var response=request(id);error(response,409,"STATE_CONFLICT");assertThat(response.getBody().path("error").path("currentStatus").asText()).isEqualTo("INVALIDATED");
        jdbc.update("UPDATE translation_version SET status='DRAFT' WHERE episode_id=?",id);
        response=request(id);error(response,409,"STATE_CONFLICT");assertThat(response.getBody().path("error").path("currentStatus").asText()).isEqualTo("DRAFT");
        assertThat(audits(id)).isZero();verifyNoInteractions(adapter);
    }
    @Test void pathsAssignmentReplacementAndRoleMatrixAreEnforced() {
        String id=start(),other=create();
        for(String path:List.of(path(other),path("999999999999999999"),path("0"),path("01"),path("abc"),path(id).replace("/1/ai-draft","/0/ai-draft"),path(id).replace("/1/ai-draft","/1000000000/ai-draft"),path(id).replace("/1/ai-draft","/2/ai-draft")))
            error(call(HttpMethod.POST,path,null,users.get(Role.TRANSLATOR).token()),404,"NOT_FOUND");
        for(Role role:List.of(Role.OPERATOR,Role.REVIEWER,Role.READER)) {
            var headers=new HttpHeaders();headers.setBearerAuth(users.get(role).token());headers.add("X-Role","TRANSLATOR");
            error(http.exchange(path(id),HttpMethod.POST,new HttpEntity<>(null,headers),JsonNode.class),403,"FORBIDDEN");
        }
        error(call(HttpMethod.POST,path(id),null,null),401,"AUTH_REQUIRED");
        error(call(HttpMethod.POST,path(id),Map.of("role","TRANSLATOR"),users.get(Role.TRANSLATOR).token()),400,"INVALID_REQUEST");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Long.class,users.get(Role.OPERATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id())).isEqualTo(3);
        long replacement=jdbc.queryForObject("SELECT id FROM demo_account WHERE login_id='demo.translator'",Long.class);
        assertThat(call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/translator",Map.of("accountId",Long.toString(replacement)),users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);
        error(request(id),404,"NOT_FOUND");
        assertThat(audits(id)).isZero();verifyNoInteractions(adapter);
    }
    @Test void anyBodyIncludingMalformedOrNonJsonIs400() {
        String id=start();
        for(String body:List.of("{}","null"," ","{broken","{\"role\":\"TRANSLATOR\"}")) error(call(HttpMethod.POST,path(id),body,users.get(Role.TRANSLATOR).token()),400,"INVALID_REQUEST");
        for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
            var headers=new HttpHeaders();headers.setContentType(type);headers.setBearerAuth(users.get(Role.TRANSLATOR).token());
            error(http.exchange(path(id),HttpMethod.POST,new HttpEntity<>("source=SECRET",headers),JsonNode.class),400,"INVALID_REQUEST");
        }
        assertThat(audits(id)).isZero();verifyNoInteractions(adapter);
    }
    @Test void duplicateInFlightIs409WithoutStatusOrSecondAuditAndLockIsReleased() throws Exception {
        String id=start();var entered=new CountDownLatch(1);var release=new CountDownLatch(1);var pool=Executors.newSingleThreadExecutor();
        doAnswer(invocation->{entered.countDown();assertThat(release.await(10,TimeUnit.SECONDS)).isTrue();return invocation.callRealMethod();}).when(adapter).generate(anyList());
        try {
            var first=pool.submit(()->request(id));assertThat(entered.await(10,TimeUnit.SECONDS)).isTrue();
            var duplicate=request(id);error(duplicate,409,"STATE_CONFLICT");assertThat(duplicate.getBody().path("error").has("currentStatus")).isFalse();assertThat(audits(id)).isEqualTo(1);
            release.countDown();assertThat(first.get(10,TimeUnit.SECONDS).getStatusCode().value()).isEqualTo(200);
            assertThat(request(id).getStatusCode().value()).isEqualTo(200);assertThat(audits(id)).isEqualTo(2);
        } finally { release.countDown();pool.shutdownNow(); }
    }
    @Test void auditAndDatabaseFailuresAreSafe503AndNeverCallProvider() {
        String id=start();var before=snapshot(id);var beforeText=texts(id);
        doThrow(new DataAccessResourceFailureException("SECRET audit failure")).when(dao).audit(anyLong(),eq("AI_DRAFT_REQUESTED"),anyLong(),anyInt(),anyLong(),any());
        error(request(id),503,"SERVICE_UNAVAILABLE");assertThat(audits(id)).isZero();verifyNoInteractions(adapter);assertThat(snapshot(id)).isEqualTo(before);assertThat(texts(id)).isEqualTo(beforeText);
        reset(dao);doThrow(new DataAccessResourceFailureException("SECRET DB failure")).when(dao).version(anyLong(),anyInt());
        error(request(id),503,"SERVICE_UNAVAILABLE");verifyNoInteractions(adapter);assertThat(audits(id)).isZero();
    }
    @Test void invalidSettingsAndProviderFailureAreSafe503AuditedAndLeaveDataUnchanged() {
        String id=start();var before=snapshot(id);var beforeText=texts(id);int attempts=0;
        for(var entry:List.of(Map.entry("AI_PROVIDER","invalid"),Map.entry("AI_TIMEOUT_SECONDS","0"),Map.entry("AI_TIMEOUT_SECONDS","121"),Map.entry("AI_TIMEOUT_SECONDS","x"),Map.entry("AI_MAX_OUTPUT_TOKENS","127"),Map.entry("AI_MAX_OUTPUT_TOKENS","8193"),Map.entry("AI_PROVIDER","anthropic"))) {
            configuration.put(entry.getKey(),entry.getValue());error(request(id),503,"AI_UNAVAILABLE");assertThat(audits(id)).isEqualTo(++attempts);
            assertThat(call(HttpMethod.GET,"/api/health",null,null).getStatusCode().value()).isEqualTo(200);
            configuration.remove(entry.getKey());configuration.put("AI_PROVIDER","mock");
        }
        doThrow(AiFailure.unavailable()).when(adapter).generate(anyList());error(request(id),503,"AI_UNAVAILABLE");assertThat(audits(id)).isEqualTo(++attempts);
        reset(adapter);assertThat(request(id).getStatusCode().value()).isEqualTo(200);assertThat(audits(id)).isEqualTo(++attempts);
        assertThat(snapshot(id)).isEqualTo(before);assertThat(texts(id)).isEqualTo(beforeText);
        assertThat(call(HttpMethod.GET,"/api/health",null,null).getStatusCode().value()).isEqualTo(200);
    }
    @Test void invalidAndUnrequestedProposalsAreDiscardedWithoutNormalizingValidText() {
        String id=start();
        doReturn(List.of(new AiModels.Suggestion(99,"SECRET unrequested"),new AiModels.Suggestion(1," \u00a0"),new AiModels.Suggestion(1,"x".repeat(4001)),new AiModels.Suggestion(1,"bad\u0000"),new AiModels.Suggestion(2," \t second\n "),new AiModels.Suggestion(1," first "),new AiModels.Suggestion(1,"duplicate"))).when(adapter).generate(anyList());
        var response=request(id);assertThat(response.getStatusCode().value()).isEqualTo(200);var list=response.getBody().path("suggestions");assertThat(list.size()).isEqualTo(2);
        assertThat(list.get(0).path("seq").intValue()).isEqualTo(1);assertThat(list.get(0).path("text").asText()).isEqualTo(" first ");
        assertThat(list.get(1).path("text").asText()).isEqualTo(" \t second\n ");
        doReturn(List.of(new AiModels.Suggestion(3,"not requested"),new AiModels.Suggestion(1,"\t"))).when(adapter).generate(anyList());
        assertThat(request(id).getBody().path("suggestions").isEmpty()).isTrue();assertThat(audits(id)).isEqualTo(2);
    }
}
