package com.mangabridge.bootstrap.history;

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
@Import(HistoryIntegrationTest.Fixtures.class)
class HistoryIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @MockitoSpyBean HistoryDao dao;
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao historyTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.history."+UUID.randomUUID();var key=new GeneratedKeyHolder();
            jdbc.update(connection->{
                var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
                statement.setString(1,login);statement.setString(2,"history fixture");statement.setString(3,role.name());statement.setString(4,encoder.encode(password));return statement;
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
    private static final Set<String> EVENTS=Set.of("EPISODE_CREATED","SOURCE_SAVED","ASSIGNED","TRANSLATION_CREATED",
            "TRANSLATION_SUBMITTED","REVIEW_APPROVED","REVIEW_REJECTED","APPROVAL_INVALIDATED","TRANSLATION_PUBLISHED","PUBLICATION_HELD","PUBLICATION_RESUMED");
    private static final Set<String> TRANSLATION_EVENTS=Set.of("TRANSLATION_CREATED","TRANSLATION_SUBMITTED","REVIEW_APPROVED","REVIEW_REJECTED","APPROVAL_INVALIDATED","TRANSLATION_PUBLISHED","PUBLICATION_HELD","PUBLICATION_RESUMED");
    private void error(ResponseEntity<JsonNode> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        var body=response.getBody();assertThat(body.fieldNames()).toIterable().containsExactly("error");
        assertThat(body.get("error").fieldNames()).toIterable().containsExactlyInAnyOrder("code","message");
        assertThat(body.get("error").get("code").textValue()).isEqualTo(code);assertThat(body.get("error").get("message").textValue()).isNotBlank();
        assertThat(body.toString()).doesNotContain("Exception","stackTrace","jdbc:","SECRET",password,"PRIVATE_COMMENT","PRIVATE_REASON");
        for(var user:users.values()) assertThat(body.toString()).doesNotContain(user.token());
    }
    private void successful(ResponseEntity<JsonNode> response) {
        assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(response.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("items","total");
    }
    private ResponseEntity<JsonNode> getWithBody(String path,String body,MediaType type,Role role,boolean forge) throws Exception {
        var request=java.net.http.HttpRequest.newBuilder(java.net.URI.create("http://127.0.0.1:"+port+path))
                .header("Authorization","Bearer "+users.get(role).token()).header("Content-Type",type.toString())
                .method("GET",java.net.http.HttpRequest.BodyPublishers.ofString(body));
        if(forge) request.header("X-Role","OPERATOR").header("X-User-Id",Long.toString(users.get(Role.OPERATOR).id()));
        var response=java.net.http.HttpClient.newHttpClient().send(request.build(),java.net.http.HttpResponse.BodyHandlers.ofString());
        var headers=new HttpHeaders();response.headers().map().forEach(headers::put);
        return new ResponseEntity<>(new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.body()),headers,HttpStatusCode.valueOf(response.statusCode()));
    }
    private List<String> ids(JsonNode body) {
        var ids=new ArrayList<String>();for(var item:body.get("items")) ids.add(item.get("id").textValue());return ids;
    }
    private void assign(String id,String role,Role account) {
        var response=call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/"+role,Map.of("accountId",Long.toString(users.get(account).id())),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
    }
    private void submit(String id,int number) {
        String path="/api/my/episodes/"+id+"/translations";String token=users.get(Role.TRANSLATOR).token();
        var created=call(HttpMethod.POST,path,null,token);assertThat(created.getStatusCode().value()).isEqualTo(201);
        assertThat(created.getBody().get("versionNo").intValue()).isEqualTo(number);
        var saved=call(HttpMethod.PUT,path+"/"+number,Map.of("expectedRevision",1,"blocks",List.of(Map.of("seq",1,"text","PRIVATE_TRANSLATION "+number),Map.of("seq",2,"text","PRIVATE_TRANSLATION second "+number))),token);
        assertThat(saved.getStatusCode().value()).isEqualTo(200);
        assertThat(call(HttpMethod.POST,path+"/"+number+"/submit",Map.of("expectedRevision",2),token).getStatusCode().value()).isEqualTo(200);
    }
    private void approve(String id,int number) {
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/reviews/"+number+"/approve",null,users.get(Role.REVIEWER).token()).getStatusCode().value()).isEqualTo(200);
    }
    private String lifecycle() {
        String id=create();assign(id,"translator",Role.TRANSLATOR);assign(id,"reviewer",Role.REVIEWER);submit(id,1);
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/reviews/1/reject",Map.of("reason","PRIVATE_REASON","comments",List.of(Map.of("seq",1,"text","PRIVATE_COMMENT"))),users.get(Role.REVIEWER).token()).getStatusCode().value()).isEqualTo(200);
        submit(id,2);approve(id,2);source(id,1,"SECRET_SOURCE_CHANGED");submit(id,3);approve(id,3);
        assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/translations/3/publish",null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);
        for(String action:List.of("hold","resume")) assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/publication/"+action,null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);
        return id;
    }
    @Test void allActualEventsHaveExactSafeFieldsAndHistoryReadsDoNotWriteAudits() {
        String id=lifecycle();jdbc.update("UPDATE episode SET title='current title' WHERE id=?",id);
        jdbc.update("INSERT INTO auth_audit(occurred_at,account_id,event,reason) VALUES (UTC_TIMESTAMP(6),?,'LOGIN_FAILURE','PRIVATE_AUTH_MARKER')",users.get(Role.OPERATOR).id());
        var domainBefore=jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id");var authBefore=jdbc.queryForList("SELECT * FROM auth_audit ORDER BY id");
        var response=get("/api/history");successful(response);var body=response.getBody();
        assertThat(body.get("total").longValue()).isEqualTo(domainBefore.size());assertThat(body.get("items").size()).isEqualTo(domainBefore.size());
        var events=new HashSet<String>();
        for(var item:body.get("items")) {
            assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id","occurredAt","event","actor","episodeId","episodeTitle","sourceVersion","translationVersionNo","subject");
            assertThat(item.get("id").isTextual()).isTrue();assertThat(item.get("episodeId").textValue()).isEqualTo(id);assertThat(item.get("episodeTitle").textValue()).isEqualTo("current title");
            assertThat(item.get("occurredAt").textValue()).endsWith("Z");Instant.parse(item.get("occurredAt").textValue());
            String event=item.get("event").textValue();events.add(event);
            long audit=Long.parseLong(item.get("id").textValue());
            Long actor=jdbc.queryForObject("SELECT actor_account_id FROM domain_audit WHERE id=?",Long.class,audit);
            assertThat(item.get("actor").fieldNames()).toIterable().containsExactlyInAnyOrder("id","displayName");
            assertThat(item.get("actor").get("id").textValue()).isEqualTo(actor.toString());
            assertThat(item.get("actor").get("displayName").textValue()).isEqualTo("history fixture");
            Integer source=jdbc.queryForObject("SELECT source_version FROM domain_audit WHERE id=?",Integer.class,audit);
            if(source==null) assertThat(item.get("sourceVersion").isNull()).isTrue();else assertThat(item.get("sourceVersion").intValue()).isEqualTo(source);
            if(TRANSLATION_EVENTS.contains(event)) {
                int version=jdbc.queryForObject("SELECT version_no FROM translation_version WHERE id=(SELECT translation_version_id FROM domain_audit WHERE id=?)",Integer.class,audit);
                assertThat(item.get("translationVersionNo").isIntegralNumber()).isTrue();assertThat(item.get("translationVersionNo").intValue()).isEqualTo(version);
            } else assertThat(item.get("translationVersionNo").isNull()).isTrue();
            if(event.equals("ASSIGNED")) {
                assertThat(item.get("subject").fieldNames()).toIterable().containsExactlyInAnyOrder("id","displayName");
                Long subject=jdbc.queryForObject("SELECT subject_account_id FROM domain_audit WHERE id=?",Long.class,audit);
                assertThat(item.get("subject").get("id").textValue()).isEqualTo(subject.toString());assertThat(item.get("subject").get("displayName").textValue()).isEqualTo("history fixture");
            } else assertThat(item.get("subject").isNull()).isTrue();
        }
        assertThat(events).isEqualTo(EVENTS);
        assertThat(body.toString()).doesNotContain("PRIVATE_REASON","PRIVATE_COMMENT","PRIVATE_TRANSLATION","SECRET_SOURCE","PRIVATE_AUTH_MARKER","LOGIN_FAILURE","password_hash","translation_version_id","loginId");
        for(var user:users.values()) assertThat(body.toString()).doesNotContain(user.token());
        assertThat(jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id")).isEqualTo(domainBefore);
        assertThat(jdbc.queryForList("SELECT * FROM auth_audit ORDER BY id")).isEqualTo(authBefore);
    }
    @Test void sortingPaginationBoundariesAndCombinedFiltersAreStable() {
        String first=create(),second=create();
        jdbc.update("UPDATE domain_audit SET occurred_at='2030-01-01 00:00:00.123456' WHERE episode_id=?",first);
        jdbc.update("UPDATE domain_audit SET occurred_at='2030-01-02 00:00:00.123456' WHERE episode_id=?",second);
        var expected=jdbc.queryForList("SELECT CAST(id AS CHAR) FROM domain_audit ORDER BY occurred_at DESC,id DESC",String.class);
        var all=get("/api/history");successful(all);assertThat(ids(all.getBody())).isEqualTo(expected);
        var page=get("/api/history?limit=1&offset=1");successful(page);assertThat(ids(page.getBody())).containsExactly(expected.get(1));assertThat(page.getBody().get("total").intValue()).isEqualTo(4);
        var end=get("/api/history?limit=100&offset=3");successful(end);assertThat(ids(end.getBody())).containsExactly(expected.get(3));
        for(String offset:List.of("4","5","9".repeat(100))) {
            var empty=get("/api/history?offset="+offset);successful(empty);assertThat(empty.getBody().get("items").isEmpty()).isTrue();assertThat(empty.getBody().get("total").intValue()).isEqualTo(4);
        }
        var episode=get("/api/history?episodeId="+first);successful(episode);assertThat(episode.getBody().get("total").intValue()).isEqualTo(2);
        for(var item:episode.getBody().get("items")) assertThat(item.get("episodeId").textValue()).isEqualTo(first);
        var event=get("/api/history?event=SOURCE_SAVED");successful(event);assertThat(event.getBody().get("total").intValue()).isEqualTo(2);
        for(var item:event.getBody().get("items")) assertThat(item.get("event").textValue()).isEqualTo("SOURCE_SAVED");
        var combined=get("/api/history?episodeId="+second+"&event=EPISODE_CREATED");successful(combined);assertThat(combined.getBody().get("total").intValue()).isEqualTo(1);
        assertThat(combined.getBody().get("items").get(0).get("episodeId").textValue()).isEqualTo(second);
        for(String query:List.of("episodeId=999999999999999999","event=PUBLICATION_HELD","episodeId="+first+"&event=PUBLICATION_RESUMED")) {
            var empty=get("/api/history?"+query);successful(empty);assertThat(empty.getBody().get("total").intValue()).isZero();assertThat(empty.getBody().get("items").isEmpty()).isTrue();
        }
    }
    @Test void invalidUnknownAndRepeatedQueryValuesAreRejectedWithoutWrites() {
        create();var before=jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id");
        for(String query:List.of("episodeId=","episodeId=0","episodeId=01","episodeId=-1","episodeId=abc","episodeId=1.0","episodeId=1000000000000000000",
                "event=","event=LOGIN_SUCCESS","event=ACCESS_DENIED","event=source_saved","event=SOURCE_SAVED,ASSIGNED",
                "limit=","limit=0","limit=101","limit=-1","limit=1.0","limit=abc","limit=1,2","limit=99999999999999999999",
                "offset=","offset=-1","offset=1.5","offset=abc","offset=0,1","unknown=x","role=OPERATOR","=x",
                "episodeId=1&episodeId=1","event=ASSIGNED&event=ASSIGNED","limit=1&limit=2","offset=0&offset=0")) {
            error(get("/api/history?"+query),400,"INVALID_REQUEST");
        }
        assertThat(jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id")).isEqualTo(before);
    }
    @Test void defaultPageSizeIsFiftyAndMaximumOneHundredIsSupported() {
        String id=create();
        for(int i=0;i<103;i++) jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id) VALUES (UTC_TIMESTAMP(6),?,'EPISODE_CREATED',?)",users.get(Role.OPERATOR).id(),id);
        var defaults=get("/api/history");successful(defaults);assertThat(defaults.getBody().get("items").size()).isEqualTo(50);assertThat(defaults.getBody().get("total").intValue()).isEqualTo(105);
        var hundred=get("/api/history?limit=100");successful(hundred);assertThat(hundred.getBody().get("items").size()).isEqualTo(100);
        var last=get("/api/history?limit=100&offset=100");successful(last);assertThat(last.getBody().get("items").size()).isEqualTo(5);
        var expected=jdbc.queryForList("SELECT CAST(id AS CHAR) FROM domain_audit ORDER BY occurred_at DESC,id DESC",String.class);
        var pages=new ArrayList<>(ids(hundred.getBody()));pages.addAll(ids(last.getBody()));assertThat(pages).isEqualTo(expected);
    }
    @Test void nullableReferencesAndNonTranslationEventsDoNotExposeInternalVersionIds() {
        String id=create();
        jdbc.update("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at) VALUES (?,77,1,'REJECTED',?,UTC_TIMESTAMP(6))",id,users.get(Role.TRANSLATOR).id());
        long version=jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=?",Long.class,id);
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,translation_version_id,subject_account_id) VALUES (UTC_TIMESTAMP(6),?,'SOURCE_SAVED',?,?,?)",users.get(Role.OPERATOR).id(),id,version,users.get(Role.READER).id());
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event) VALUES (UTC_TIMESTAMP(6),?,'EPISODE_CREATED')",users.get(Role.OPERATOR).id());
        var response=get("/api/history");successful(response);
        var newest=response.getBody().get("items").get(0);assertThat(newest.get("episodeId").isNull()).isTrue();assertThat(newest.get("episodeTitle").isNull()).isTrue();
        assertThat(newest.get("sourceVersion").isNull()).isTrue();assertThat(newest.get("translationVersionNo").isNull()).isTrue();assertThat(newest.get("subject").isNull()).isTrue();
        for(var item:response.getBody().get("items")) {assertThat(item.get("translationVersionNo").isNull()).isTrue();assertThat(item.get("subject").isNull()).isTrue();}
    }
    @Test void roleMatrixHeaderAndBodyForgeryAreRejectedAndDenialsAreAudited() throws Exception {
        create();long before=jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit",Long.class);
        for(Role role:Role.values()) {
            var response=call(HttpMethod.GET,"/api/history",null,users.get(role).token());
            if(role==Role.OPERATOR) successful(response);else error(response,403,"FORBIDDEN");
        }
        error(call(HttpMethod.GET,"/api/history",null,null),401,"AUTH_REQUIRED");
        error(getWithBody("/api/history","{\"role\":\"OPERATOR\"}",MediaType.APPLICATION_JSON,Role.TRANSLATOR,true),403,"FORBIDDEN");
        successful(getWithBody("/api/history","{\"role\":\"READER\"}",MediaType.APPLICATION_JSON,Role.OPERATOR,false));
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Integer.class,users.get(Role.TRANSLATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id())).isEqualTo(4);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit",Long.class)).isEqualTo(before);
    }
    @Test void getBodiesAreIgnoredIncludingNonJsonAndCorsKeepsExistingContract() throws Exception {
        create();var before=get("/api/history").getBody();
        for(var type:List.of(MediaType.APPLICATION_JSON,MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
            var response=getWithBody("/api/history","{ malformed and ignored",type,Role.OPERATOR,false);successful(response);assertThat(response.getBody()).isEqualTo(before);
            error(getWithBody("/api/history?extra=x","ignored",type,Role.OPERATOR,false),400,"INVALID_REQUEST");
        }
        var headers=new HttpHeaders();headers.setOrigin("http://localhost:3000");headers.setAccessControlRequestMethod(HttpMethod.GET);headers.setAccessControlRequestHeaders(List.of("Authorization"));
        var preflight=http.exchange("/api/history",HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
        assertThat(preflight.getStatusCode().value()).isEqualTo(200);assertThat(preflight.getHeaders().getAccessControlAllowOrigin()).isEqualTo("http://localhost:3000");assertThat(preflight.getHeaders().getAccessControlAllowHeaders()).contains("Authorization");assertThat(preflight.getHeaders().getAccessControlAllowCredentials()).isFalse();
    }
    @Test void databaseFailuresReturnSafe503WithoutChangingHistory() {
        create();var before=jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id");
        doThrow(new DataAccessResourceFailureException("SECRET count failure")).when(dao).count(any());error(get("/api/history"),503,"SERVICE_UNAVAILABLE");reset(dao);
        doThrow(new DataAccessResourceFailureException("SECRET item failure")).when(dao).items(any());error(get("/api/history"),503,"SERVICE_UNAVAILABLE");reset(dao);
        var dead=new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:mysql://127.0.0.1:1/unreachable");
        var properties=new Properties();properties.setProperty("user",System.getenv("DB_USERNAME"));properties.setProperty("password",System.getenv("DB_PASSWORD"));properties.setProperty("connectTimeout","2000");properties.setProperty("socketTimeout","3000");properties.setProperty("sslMode","DISABLED");dead.setConnectionProperties(properties);
        var service=new HistoryService(new HistoryDao(new JdbcTemplate(dead)),new org.springframework.jdbc.datasource.DataSourceTransactionManager(dead));
        assertThatThrownBy(()->service.listHistory(Map.of())).isInstanceOfSatisfying(HistoryFailure.class,failure->{assertThat(failure.status).isEqualTo(503);assertThat(failure.code).isEqualTo("SERVICE_UNAVAILABLE");});
        assertThat(jdbc.queryForList("SELECT * FROM domain_audit ORDER BY id")).isEqualTo(before);
    }
}
