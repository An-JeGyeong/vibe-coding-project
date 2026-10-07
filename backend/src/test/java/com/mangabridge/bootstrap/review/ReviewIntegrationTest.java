package com.mangabridge.bootstrap.review;
import com.mangabridge.bootstrap.translation.TranslationDao;

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
@Import(ReviewIntegrationTest.Fixtures.class)
class ReviewIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @Autowired FixtureAddress address;
    @MockitoSpyBean TranslationDao dao;
    @MockitoSpyBean ReviewDao reviewDao;
    @MockitoSpyBean EpisodeDao sourceDao;
    private final Set<Long> accounts=new HashSet<>();
    private final Set<String> loginIds=new HashSet<>();
    private final Set<String> episodes=new HashSet<>();
    private Identity operator;
    private String password;
    private record Identity(long id,String token) { }
    static class FixtureAddress { volatile String current; }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao reviewTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
        @Bean FixtureAddress reviewFixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> reviewFixtureFilter(FixtureAddress address) {
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    @BeforeEach void setup() {
        address.current="fixture.review."+UUID.randomUUID(); password=UUID.randomUUID().toString();
        operator=identity(Role.OPERATOR);
    }
    private Identity identity(Role role) {
        String loginId="test.review."+UUID.randomUUID(); loginIds.add(loginId);
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
        reset(dao,sourceDao,reviewDao); tracking.cleanupAudits();
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
    private String reviews(String id) { return "/api/my/episodes/"+id+"/reviews"; }
    private String operatorTranslations(String id) { return "/api/episodes/"+id+"/translations"; }
    private ResponseEntity<JsonNode> approve(String id,int version,Identity reviewer) {
        return request(HttpMethod.POST,reviews(id)+"/"+version+"/approve",null,reviewer.token());
    }
    private ResponseEntity<JsonNode> reject(String id,int version,Object reason,Identity reviewer) {
        return request(HttpMethod.POST,reviews(id)+"/"+version+"/reject",reason,reviewer.token());
    }
    private String pending(Identity translator,Identity reviewer) {
        String id=prepared(translator); assign(id,"reviewer",reviewer.id());
        assertThat(start(id,translator).getStatusCode().value()).isEqualTo(201);
        assertThat(save(id,1,draft(1,1,"  translation\n",2,"second"),translator).getStatusCode().value()).isEqualTo(200);
        assertThat(submit(id,1,2,translator).getStatusCode().value()).isEqualTo(200); return id;
    }
    private int decisions(String id) { return jdbc.queryForObject("SELECT COUNT(*) FROM review_decision WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",Integer.class,id); }
    private String status(String id) { return jdbc.queryForObject("SELECT status FROM translation_version WHERE episode_id=? AND version_no=1",String.class,id); }
    private void resetDecision(String id) {
        jdbc.update("DELETE FROM review_decision WHERE translation_version_id=?",translationId(id,1));
        jdbc.update("UPDATE translation_version SET status='REVIEW_PENDING' WHERE episode_id=? AND version_no=1",id);
    }
    @Test void pendingQueueIsAssignedFilteredSortedAndPaged() {
        var translator=identity(Role.TRANSLATOR); var reviewer=identity(Role.REVIEWER); var other=identity(Role.REVIEWER);
        String first=pending(translator,reviewer),second=pending(translator,reviewer),foreign=pending(translator,other);
        jdbc.update("UPDATE translation_version SET submitted_at='2020-01-01 00:00:00' WHERE episode_id=?",first);
        jdbc.update("UPDATE translation_version SET submitted_at='2020-01-02 00:00:00' WHERE episode_id=?",second);
        String draftId=prepared(translator); assign(draftId,"reviewer",reviewer.id()); start(draftId,translator);
        var queue=get("/api/my/reviews",reviewer.token()); assertThat(queue.getStatusCode().value()).isEqualTo(200);
        assertThat(queue.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("items","total");
        assertThat(queue.getBody().get("total").intValue()).isEqualTo(2);
        assertThat(queue.getBody().get("items").get(0).get("episodeId").textValue()).isEqualTo(first);
        assertThat(queue.getBody().get("items").get(1).get("episodeId").textValue()).isEqualTo(second);
        assertThat(queue.getBody().get("items").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("episodeId","title","versionNo","sourceVersion","submittedAt");
        assertThat(get("/api/my/reviews?limit=1&offset=1",reviewer.token()).getBody().get("items").get(0).get("episodeId").textValue()).isEqualTo(second);
        assertThat(get("/api/my/reviews?limit=100&offset=99999999999999999999999",reviewer.token()).getBody().get("items")).isEmpty();
        for(String query:List.of("limit=0","limit=101","limit=-1","limit=x","limit=","offset=-1","offset=1.0","offset=")) error(get("/api/my/reviews?"+query,reviewer.token()),400,"INVALID_REQUEST");
        approve(first,1,reviewer); assertThat(get("/api/my/reviews",reviewer.token()).getBody().get("total").intValue()).isEqualTo(1);
    }
    @Test void reviewerVisibilityAndOperatorAllStatesAndPaths() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER); String id=pending(translator,reviewer);
        var detail=get(reviews(id)+"/1",reviewer.token()).getBody();
        assertThat(detail.fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","sourceVersion","submittedAt","decidable","decision","blocks","blockComments");
        assertThat(detail.get("blockComments").isArray()).isTrue();assertThat(detail.get("blockComments").size()).isZero();
        assertThat(detail.get("decidable").booleanValue()).isTrue(); assertThat(detail.get("decision").isNull()).isTrue();
        assertThat(detail.get("blocks").size()).isEqualTo(2);
        assertThat(detail.get("blocks").get(0).get("source").textValue()).isEqualTo("원문 😀 1");
        assertThat(detail.get("blocks").get(0).get("text").textValue()).isEqualTo("  translation\n");
        assertThat(detail.get("blocks").get(0).get("pageNo").intValue()).isEqualTo(3);
        assertThat(detail.get("blocks").get(1).get("pageNo").isNull()).isTrue();
        for(String state:List.of("DRAFT","REVIEW_PENDING","APPROVED","REJECTED","INVALIDATED","PUBLISHED","ON_HOLD")) {
            jdbc.update("UPDATE translation_version SET status=? WHERE episode_id=?",state,id);
            var list=get(reviews(id),reviewer.token()).getBody().get("items");
            if(Set.of("REVIEW_PENDING","APPROVED","REJECTED").contains(state)) {
                assertThat(list.size()).isEqualTo(1);
                assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("decidable").booleanValue()).isEqualTo(state.equals("REVIEW_PENDING"));
            } else { assertThat(list).isEmpty();error(get(reviews(id)+"/1",reviewer.token()),404,"NOT_FOUND"); }
            var op=get(operatorTranslations(id)+"/1"); assertThat(op.getStatusCode().value()).isEqualTo(200);
            assertThat(op.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","sourceVersion","createdAt","submittedAt","decision","invalidatedAt","blocks","blockComments");
            assertThat(op.getBody().get("blockComments").isArray()).isTrue();assertThat(op.getBody().get("blockComments").size()).isZero();
            assertThat(op.getBody().get("status").textValue()).isEqualTo(state);
            assertThat(get(operatorTranslations(id)).getBody().get("items").size()).isEqualTo(1);
        }
        for(String value:List.of("0","01","-1","x","1000000000")) {
            error(get(reviews(id)+"/"+value,reviewer.token()),404,"NOT_FOUND"); error(get(operatorTranslations(id)+"/"+value),404,"NOT_FOUND");
        }
        for(String value:List.of("0","01","-1","x","1000000000000000000")) error(get(reviews(value),reviewer.token()),404,"NOT_FOUND");
        error(get(operatorTranslations(id)+"/999"),404,"NOT_FOUND"); error(get(operatorTranslations("999999999999999999")),404,"NOT_FOUND");
    }
    @Test void approvalAndSourceInvalidationStayAtomicAndDecisionIsAdditive() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER); String id=pending(translator,reviewer);
        var response=approve(id,1,reviewer);assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","status","decidedAt");
        assertThat(response.getBody().get("decidedAt").textValue()).endsWith("Z");
        assertThat(status(id)).isEqualTo("APPROVED");assertThat(decisions(id)).isEqualTo(1);assertThat(domainCount(id,"REVIEW_APPROVED")).isEqualTo(1);
        var audit=jdbc.queryForMap("SELECT actor_account_id,source_version,translation_version_id,occurred_at FROM domain_audit WHERE episode_id=? AND event='REVIEW_APPROVED'",id);
        assertThat(((Number)audit.get("actor_account_id")).longValue()).isEqualTo(reviewer.id());
        assertThat(((Number)audit.get("source_version")).intValue()).isEqualTo(1);
        assertThat(((Number)audit.get("translation_version_id")).longValue()).isEqualTo(translationId(id,1));
        assertThat(jdbc.queryForObject("SELECT decided_at=occurred_at FROM review_decision r JOIN domain_audit a ON a.translation_version_id=r.translation_version_id AND a.event='REVIEW_APPROVED' WHERE a.episode_id=?",Boolean.class,id)).isTrue();
        for(String path:List.of(reviews(id)+"/1",translations(id)+"/1",operatorTranslations(id)+"/1")) {
            String token=path.startsWith(operatorTranslations(id))?operator.token():path.startsWith(reviews(id))?reviewer.token():translator.token();
            var decision=get(path,token).getBody().get("decision");
            assertThat(decision.fieldNames()).toIterable().containsExactlyInAnyOrder("decision","decidedAt","reason");
            assertThat(decision.get("decision").textValue()).isEqualTo("APPROVED");assertThat(decision.get("reason").isNull()).isTrue();
        }
        assertThat(get(translations(id),translator.token()).getBody().get("items").get(0).get("decision").get("decision").textValue()).isEqualTo("APPROVED");
        error(approve(id,1,reviewer),409,"STATE_CONFLICT"); error(reject(id,1,Map.of("reason","again"),reviewer),409,"STATE_CONFLICT");
        assertThat(source(id,1,2,"원문 😀 ").getBody().get("changed").booleanValue()).isFalse(); assertThat(status(id)).isEqualTo("APPROVED");
        assertThat(source(id,1,2,"changed").getStatusCode().value()).isEqualTo(201);
        assertThat(status(id)).isEqualTo("INVALIDATED");
        assertThat(jdbc.queryForObject("SELECT invalidated_at IS NOT NULL FROM review_decision WHERE translation_version_id=?",Boolean.class,translationId(id,1))).isTrue();
        assertThat(domainCount(id,"APPROVAL_INVALIDATED")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT source_version FROM domain_audit WHERE episode_id=? AND event='APPROVAL_INVALIDATED'",Integer.class,id)).isEqualTo(2);
        assertThat(get(operatorTranslations(id)+"/1").getBody().get("invalidatedAt").textValue()).endsWith("Z");
        error(get(reviews(id)+"/1",reviewer.token()),404,"NOT_FOUND");
        var conflict=approve(id,1,reviewer);error(conflict,409,"STATE_CONFLICT");assertThat(conflict.getBody().get("error").get("currentStatus").textValue()).isEqualTo("INVALIDATED");
    }
    @Test void rejectionReasonBoundariesPrivacyAndNewDraftCopy() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);var outsider=identity(Role.TRANSLATOR);var stranger=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        for(Object body:List.of(Map.of(),Map.of("reason",123),Map.of("reason",""),Map.of("reason"," \t\n\u00a0"),Map.of("reason","a".repeat(501)),Map.of("reason","bad\u0000"),Map.of("reason","bad\u000b"),Map.of("reason","x","role","REVIEWER"))) error(reject(id,1,body,reviewer),400,"INVALID_REQUEST");
        error(reject(id,1,null,reviewer),400,"INVALID_REQUEST");assertThat(decisions(id)).isZero();
        for(String reason:List.of("x","😀".repeat(500),"  sensitive reason\t\n\r  ")) {
            assertThat(reject(id,1,Map.of("reason",reason),reviewer).getStatusCode().value()).isEqualTo(200);
            assertThat(get(translations(id)+"/1",translator.token()).getBody().get("decision").get("reason").textValue()).isEqualTo(reason);
            assertThat(get(translations(id),translator.token()).getBody().get("items").get(0).get("decision").get("reason").textValue()).isEqualTo(reason);
            assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("decision").get("reason").textValue()).isEqualTo(reason);
            assertThat(get(operatorTranslations(id)+"/1").getBody().get("decision").get("reason").textValue()).isEqualTo(reason);
            resetDecision(id);
        }
        reject(id,1,Map.of("reason","private rejection"),reviewer); error(reject(id,1,Map.of("reason","again"),reviewer),409,"STATE_CONFLICT");
        error(get(translations(id)+"/1",outsider.token()),404,"NOT_FOUND");error(get(reviews(id)+"/1",stranger.token()),404,"NOT_FOUND");
        assertThat(start(id,translator).getBody().get("versionNo").intValue()).isEqualTo(2);
        var copied=get(translations(id)+"/2",translator.token()).getBody();assertThat(copied.get("decision").isNull()).isTrue();
        assertThat(copied.get("blocks").get(0).get("text").textValue()).isEqualTo("  translation\n");
        var list=get(reviews(id),reviewer.token()).getBody().get("items");assertThat(list.size()).isEqualTo(1);assertThat(list.get(0).get("versionNo").intValue()).isEqualTo(1);
        assertThat(jdbc.queryForList("SELECT event FROM domain_audit WHERE episode_id=?",String.class,id)).doesNotContain("private rejection");
    }
    @Test void roleMatrixAndForgedRolesCannotExposeReason() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);var reader=identity(Role.READER);String id=pending(translator,reviewer);
        var paths=List.of("/api/my/reviews",reviews(id),reviews(id)+"/1",reviews(id)+"/1/approve",reviews(id)+"/1/reject",operatorTranslations(id),operatorTranslations(id)+"/1");
        for(Identity actor:Arrays.asList(null,operator,translator,reviewer,reader)) for(int i=0;i<paths.size();i++) {
            HttpMethod method=i==3||i==4?HttpMethod.POST:HttpMethod.GET; Object body=i==4?Map.of("reason","matrix reason"):null;
            boolean allowed=actor!=null && (i<5?actor==reviewer:actor==operator);
            var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.set("X-Role",i<5?"REVIEWER":"OPERATOR");headers.set("X-User-Id",Long.toString(reviewer.id()));
            if(actor!=null)headers.setBearerAuth(actor.token());
            var response=http.exchange(paths.get(i),method,new HttpEntity<>(body,headers),JsonNode.class);
            if(allowed) { assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");if(i==3||i==4)resetDecision(id); }
            else error(response,actor==null?401:403,actor==null?"AUTH_REQUIRED":"FORBIDDEN");
        }
        error(reject(id,1,Map.of("reason","x","role","REVIEWER"),reviewer),400,"INVALID_REQUEST");
        error(request(HttpMethod.POST,reviews(id)+"/1/approve",Map.of("role","REVIEWER"),reviewer.token()),400,"INVALID_REQUEST");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Integer.class,operator.id(),translator.id(),reader.id())).isEqualTo(19);
    }
    @Test void replacementAndUnassignedReviewerCannotReadOrDecide() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);var successor=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        for(String path:List.of(reviews(id),reviews(id)+"/1")) error(get(path,successor.token()),404,"NOT_FOUND");
        error(approve(id,1,successor),404,"NOT_FOUND"); error(reject(id,1,Map.of("reason","x"),successor),404,"NOT_FOUND");
        assign(id,"reviewer",successor.id());
        assertThat(get("/api/my/reviews",reviewer.token()).getBody().get("items")).isEmpty();
        error(get(reviews(id),reviewer.token()),404,"NOT_FOUND");error(get(reviews(id)+"/1",reviewer.token()),404,"NOT_FOUND");error(approve(id,1,reviewer),404,"NOT_FOUND");error(reject(id,1,Map.of("reason","x"),reviewer),404,"NOT_FOUND");
        assertThat(get(reviews(id)+"/1",successor.token()).getBody().get("decidable").booleanValue()).isTrue();assertThat(approve(id,1,successor).getStatusCode().value()).isEqualTo(200);
    }
    @Test void everyNonPendingStateAndStaleSourceRejectMutations() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        for(String state:List.of("DRAFT","APPROVED","REJECTED","INVALIDATED","PUBLISHED","ON_HOLD")) {
            jdbc.update("UPDATE translation_version SET status=? WHERE episode_id=?",state,id);
            var response=approve(id,1,reviewer);error(response,409,"STATE_CONFLICT");assertThat(response.getBody().get("error").get("currentStatus").textValue()).isEqualTo(state);
            error(reject(id,1,Map.of("reason","x"),reviewer),409,"STATE_CONFLICT");assertThat(decisions(id)).isZero();
        }
        source(id,1,2,"new source");jdbc.update("UPDATE translation_version SET status='REVIEW_PENDING' WHERE episode_id=?",id);
        error(approve(id,1,reviewer),409,"STATE_CONFLICT");error(reject(id,1,Map.of("reason","x"),reviewer),409,"STATE_CONFLICT");
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("decidable").booleanValue()).isFalse();
    }
    @Test void reviewHistoryIsDescendingAndKeepsBoundSourceAndDecisionPrivacy() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        assertThat(reject(id,1,Map.of("reason","  correction\n  "),reviewer).getStatusCode().value()).isEqualTo(200);
        assertThat(domainCount(id,"REVIEW_REJECTED")).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT reviewer_id FROM review_decision WHERE translation_version_id=?",Long.class,translationId(id,1))).isEqualTo(reviewer.id());
        start(id,translator);submit(id,2,1,translator);
        var history=get(reviews(id),reviewer.token()).getBody().get("items");
        assertThat(history.size()).isEqualTo(2);assertThat(history.get(0).get("versionNo").intValue()).isEqualTo(2);assertThat(history.get(1).get("versionNo").intValue()).isEqualTo(1);
        assertThat(history.get(0).get("decision").isNull()).isTrue();assertThat(history.get(1).get("decision").get("reason").textValue()).isEqualTo("  correction\n  ");
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("decidable").booleanValue()).isFalse();
        source(id,1,1,"different source");
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("blocks").get(0).get("source").textValue()).isEqualTo("원문 😀 1");
        for(var response:List.of(get(operatorTranslations(id)),get(operatorTranslations(id)+"/1"),get(reviews(id),reviewer.token()))) {
            assertThat(response.getBody().toString()).doesNotContain("reviewerId","createdBy","reviewer_id","displayName","password_hash",password,operator.token());
        }
    }
    @Test void selfReviewDenialIsAuditedAndDecisionRemainsAbsent() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        jdbc.update("UPDATE translation_version SET created_by=? WHERE episode_id=?",reviewer.id(),id);
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("decidable").booleanValue()).isFalse();
        error(approve(id,1,reviewer),403,"FORBIDDEN");error(reject(id,1,Map.of("reason","x"),reviewer),403,"FORBIDDEN");
        assertThat(status(id)).isEqualTo("REVIEW_PENDING");assertThat(decisions(id)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE account_id=? AND event='ACCESS_DENIED'",Integer.class,reviewer.id())).isEqualTo(2);
    }
    @Test void auditFailureRollsBackApprovalAndRejection() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        doThrow(new DataIntegrityViolationException("SECRET audit failure")).when(reviewDao).audit(anyLong(),anyString(),anyLong(),anyInt(),anyLong(),any());
        error(approve(id,1,reviewer),503,"SERVICE_UNAVAILABLE");error(reject(id,1,Map.of("reason","x"),reviewer),503,"SERVICE_UNAVAILABLE");
        assertThat(status(id)).isEqualTo("REVIEW_PENDING");assertThat(decisions(id)).isZero();assertThat(domainCount(id,"REVIEW_APPROVED")).isZero();assertThat(domainCount(id,"REVIEW_REJECTED")).isZero();
        reset(reviewDao);assertThat(approve(id,1,reviewer).getStatusCode().value()).isEqualTo(200);
    }
    @Test void concurrentApprovalAndRejectionProduceExactlyOneDecision() throws Exception {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        var executor=Executors.newFixedThreadPool(2);var ready=new CountDownLatch(2);var start=new CountDownLatch(1);
        try {
            var a=executor.submit(()->{ready.countDown();start.await();return approve(id,1,reviewer);});
            var b=executor.submit(()->{ready.countDown();start.await();return reject(id,1,Map.of("reason","race"),reviewer);});
            assertThat(ready.await(5,TimeUnit.SECONDS)).isTrue();start.countDown();var ra=a.get(10,TimeUnit.SECONDS);var rb=b.get(10,TimeUnit.SECONDS);
            assertThat(List.of(ra.getStatusCode().value(),rb.getStatusCode().value())).containsExactlyInAnyOrder(200,409);
            error(ra.getStatusCode().value()==409?ra:rb,409,"STATE_CONFLICT");assertThat(decisions(id)).isEqualTo(1);
            assertThat(domainCount(id,"REVIEW_APPROVED")+domainCount(id,"REVIEW_REJECTED")).isEqualTo(1);
            assertThat(jdbc.queryForObject("SELECT decision FROM review_decision WHERE translation_version_id=?",String.class,translationId(id,1))).isEqualTo(status(id));
        } finally {start.countDown();executor.shutdownNow();}
    }
    @Test void protocolErrorsPreflightAndUnavailableDatabaseAreSafe() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        for(String operation:List.of("approve","reject")) {
            String path=reviews(id)+"/1/"+operation;
            for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
                var headers=new HttpHeaders();headers.setContentType(type);headers.setBearerAuth(reviewer.token());
                error(http.exchange(path,HttpMethod.POST,new HttpEntity<>("invalid",headers),JsonNode.class),400,"INVALID_REQUEST");
            }
            for(String body:List.of("{","null","{}"," ")) error(request(HttpMethod.POST,path,body,reviewer.token()),400,"INVALID_REQUEST");
            var headers=new HttpHeaders();headers.setOrigin(System.getenv("CORS_ALLOWED_ORIGINS").split(",")[0]);headers.setAccessControlRequestMethod(HttpMethod.POST);headers.setAccessControlRequestHeaders(List.of("Authorization","Content-Type"));
            var response=http.exchange(path,HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
            assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getHeaders().getAccessControlAllowOrigin()).isEqualTo(headers.getOrigin());assertThat(response.getHeaders().getAccessControlAllowHeaders()).contains("Authorization","Content-Type");assertThat(response.getHeaders().getAccessControlAllowCredentials()).isFalse();
        }
        assertThat(decisions(id)).isZero();
        doThrow(new DataIntegrityViolationException("SECRET jdbc failure")).when(reviewDao).count(anyLong());error(get("/api/my/reviews",reviewer.token()),503,"SERVICE_UNAVAILABLE");reset(reviewDao);
        var dead=new DriverManagerDataSource("jdbc:mysql://127.0.0.1:1/unreachable");
        var properties=new Properties();properties.setProperty("user",System.getenv("DB_USERNAME"));properties.setProperty("password",System.getenv("DB_PASSWORD"));properties.setProperty("connectTimeout","2000");properties.setProperty("socketTimeout","3000");properties.setProperty("sslMode","DISABLED");dead.setConnectionProperties(properties);
        var deadJdbc=new JdbcTemplate(dead);
        var service=new ReviewService(new ReviewDao(deadJdbc),new TranslationDao(deadJdbc),new EpisodeDao(deadJdbc),new AssignmentDao(deadJdbc),null,Clock.systemUTC(),new org.springframework.jdbc.datasource.DataSourceTransactionManager(dead));
        var actor=new com.mangabridge.bootstrap.auth.AuthModels.CurrentUser(new com.mangabridge.bootstrap.auth.AuthModels.User(Long.toString(reviewer.id()),"fixture",Role.REVIEWER),Instant.now().plusSeconds(60));
        assertThatThrownBy(()->service.listPendingReviews(actor,"50","0")).isInstanceOfSatisfying(ReviewFailure.class,e->{assertThat(e.status).isEqualTo(503);assertThat(e.code).isEqualTo("SERVICE_UNAVAILABLE");});
        for(Runnable action:List.<Runnable>of(()->service.listEpisodeReviews(actor,id),()->service.getReview(actor,id,"1"),
                ()->service.approveTranslation(actor,id,"1"),()->service.rejectTranslation(actor,id,"1",new ReviewModels.RejectRequest(new com.fasterxml.jackson.databind.node.TextNode("reason"))),
                ()->service.listTranslationsForOperator(id),()->service.getTranslationForOperator(id,"1")))
            assertThatThrownBy(action::run).isInstanceOfSatisfying(ReviewFailure.class,e->{assertThat(e.status).isEqualTo(503);assertThat(e.code).isEqualTo("SERVICE_UNAVAILABLE");});
    }
}
