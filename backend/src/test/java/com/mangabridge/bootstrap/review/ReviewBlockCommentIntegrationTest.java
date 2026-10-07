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
@Import(ReviewBlockCommentIntegrationTest.Fixtures.class)
class ReviewBlockCommentIntegrationTest {
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
        @Bean @Primary TrackingAuthDao commentTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
        @Bean FixtureAddress commentFixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> commentFixtureFilter(FixtureAddress address) {
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    @BeforeEach void setup() {
        address.current="fixture.comment."+UUID.randomUUID(); password=UUID.randomUUID().toString();
        operator=identity(Role.OPERATOR);
    }
    private Identity identity(Role role) {
        String loginId="test.comment."+UUID.randomUUID(); loginIds.add(loginId);
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
    private Map<String,Object> comments(Object... pairs) {
        var result=new ArrayList<Map<String,Object>>();
        for(int i=0;i<pairs.length;i+=2) result.add(Map.of("seq",pairs[i],"text",pairs[i+1]));
        return Map.of("reason","  reason\nkept  ","comments",result);
    }
    private int commentCount(String id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM review_block_comment WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",Integer.class,id);
    }
    private void unchanged(String id) {
        assertThat(status(id)).isEqualTo("REVIEW_PENDING");assertThat(decisions(id)).isZero();
        assertThat(commentCount(id)).isZero();assertThat(domainCount(id,"REVIEW_REJECTED")).isZero();
    }
    private long decisionId(String id) {
        return jdbc.queryForObject("SELECT id FROM review_decision WHERE translation_version_id=?",Long.class,translationId(id,1));
    }
    @Test void rejectedCommentsAreSortedExactAndOnlyInThreeDetails() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);
        String id=pending(translator,reviewer);String first="  comment\nline\t😀  ",second="😀".repeat(300);
        var response=reject(id,1,comments(2,second,1,first),reviewer);
        assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(commentCount(id)).isEqualTo(2);
        assertThat(decisions(id)).isEqualTo(1);assertThat(domainCount(id,"REVIEW_REJECTED")).isEqualTo(1);
        JsonNode expected=get(reviews(id)+"/1",reviewer.token()).getBody().get("blockComments");
        assertThat(expected.size()).isEqualTo(2);assertThat(expected.get(0).get("seq").intValue()).isEqualTo(1);
        assertThat(expected.get(0).get("text").textValue()).isEqualTo(first);assertThat(expected.get(1).get("text").textValue()).isEqualTo(second);
        for(var item:expected) {
            assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("seq","text","createdAt");
            assertThat(Instant.parse(item.get("createdAt").textValue())).isEqualTo(Instant.parse(response.getBody().get("decidedAt").textValue()));
        }
        assertThat(get(translations(id)+"/1",translator.token()).getBody().get("blockComments")).isEqualTo(expected);
        assertThat(get(operatorTranslations(id)+"/1").getBody().get("blockComments")).isEqualTo(expected);
        for(var list:List.of(get(translations(id),translator.token()),get(reviews(id),reviewer.token()),get(operatorTranslations(id))))
            for(var item:list.getBody().get("items")) assertThat(item.has("blockComments")).isFalse();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM review_block_comment c JOIN review_decision d ON d.id=c.review_decision_id WHERE c.translation_version_id<>d.translation_version_id",Integer.class)).isZero();
        error(reject(id,1,comments(1,"second attempt"),reviewer),409,"STATE_CONFLICT");assertThat(commentCount(id)).isEqualTo(2);
        assertThat(start(id,translator).getStatusCode().value()).isEqualTo(201);
        var draft=get(translations(id)+"/2",translator.token()).getBody();assertThat(draft.get("blockComments").isEmpty()).isTrue();
        assertThat(draft.get("blocks").get(0).get("text").textValue()).isEqualTo("  translation\n");
        assertThat(get(translations(id)+"/1",translator.token()).getBody().get("blockComments")).isEqualTo(expected);
    }
    @Test void optionalCommentsAndNonRejectedVersionsAlwaysReturnEmptyArrays() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);
        for(Object body:List.of(Map.of("reason","reason"),comments())) {
            String id=pending(translator,reviewer);assertThat(reject(id,1,body,reviewer).getStatusCode().value()).isEqualTo(200);
            assertThat(commentCount(id)).isZero();
            for(var detail:List.of(get(translations(id)+"/1",translator.token()),get(reviews(id)+"/1",reviewer.token()),get(operatorTranslations(id)+"/1")))
                assertThat(detail.getBody().get("blockComments").isArray() && detail.getBody().get("blockComments").isEmpty()).isTrue();
        }
        String id=pending(translator,reviewer);
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("blockComments").isEmpty()).isTrue();
        assertThat(approve(id,1,reviewer).getStatusCode().value()).isEqualTo(200);
        assertThat(get(reviews(id)+"/1",reviewer.token()).getBody().get("blockComments").isEmpty()).isTrue();
        assertThat(commentCount(id)).isZero();
    }
    @Test void invalidCommentShapesBoundsAndUnknownFieldsLeavePendingUntouched() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        var bodies=new ArrayList<Object>();
        bodies.addAll(List.of(comments(0,"bad"),comments(-1,"bad"),comments(3,"missing"),comments(1,"x",1,"duplicate"),
                comments(1,""),comments(1," \t\n\u00a0"),comments(1,"x".repeat(301)),comments(1,"\u0000"),comments(1,"\u000b"),
                comments("1","text"),comments(1.0,"text"),comments(2147483648L,"text"),comments(1,42),
                Map.of("reason","reason","comments",Map.of("seq",1,"text","x")),
                Map.of("reason","reason","comments",List.of(Map.of("seq",1))),
                Map.of("reason","reason","comments",List.of(Map.of("seq",1,"text","x","role","REVIEWER"))),
                Map.of("reason","reason","comments",List.of("item")),Map.of("reason","reason","comments",List.of()),
                Map.of("reason","reason","comments",List.of(Map.of("seq",1,"text","x")),"extra",true)));
        // Empty array is valid and tested above; remove it from the invalid cases.
        bodies.remove(Map.of("reason","reason","comments",List.of()));
        bodies.add(Map.of("reason","reason","comments",java.util.stream.IntStream.rangeClosed(1,51).mapToObj(i->Map.of("seq",i,"text","x")).toList()));
        bodies.add("{\"reason\":\"reason\",\"comments\":null}");
        bodies.add("{\"reason\":\"reason\",\"comments\":[null]}");
        bodies.add("{\"reason\":\"reason\",\"comments\":[{\"seq\":null,\"text\":\"x\"}]}");
        bodies.add("{\"reason\":\"reason\",\"comments\":[{\"seq\":1,\"text\":null}]}");
        bodies.add("{");
        for(Object body:bodies) {error(reject(id,1,body,reviewer),400,"INVALID_REQUEST");unchanged(id);}
        error(request(HttpMethod.POST,reviews(id)+"/1/approve",comments(1,"not allowed"),reviewer.token()),400,"INVALID_REQUEST");unchanged(id);
        for(var type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
            var headers=new HttpHeaders();headers.setContentType(type);headers.setBearerAuth(reviewer.token());
            error(http.exchange(reviews(id)+"/1/reject",HttpMethod.POST,new HttpEntity<>("reason=bad",headers),JsonNode.class),400,"INVALID_REQUEST");unchanged(id);
        }
    }
    @Test void serviceRejectsDecisionVersionMismatchBeforeAnyCommentInsert() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);
        String id=pending(translator,reviewer),foreign=pending(translator,reviewer);
        assertThat(reject(foreign,1,Map.of("reason","foreign"),reviewer).getStatusCode().value()).isEqualTo(200);
        long foreignDecision=decisionId(foreign);clearInvocations(reviewDao);
        doReturn(foreignDecision).when(reviewDao).decisionId(translationId(id,1));
        error(reject(id,1,comments(1,"SECRET"),reviewer),503,"SERVICE_UNAVAILABLE");
        verify(reviewDao,never()).insertComment(anyLong(),anyLong(),any(),any());unchanged(id);assertThat(commentCount(foreign)).isZero();
    }
    @Test void fiftyCommentsAreAllowedAndSeqMustHaveAnActualTranslationBlock() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);
        String id=create("fifty blocks");source(id,0,50,"source");assign(id,"translator",translator.id());assign(id,"reviewer",reviewer.id());start(id,translator);
        var blocks=java.util.stream.IntStream.rangeClosed(1,50).mapToObj(i->Map.of("seq",i,"text","translation "+i)).toList();
        save(id,1,Map.of("expectedRevision",1,"blocks",blocks),translator);submit(id,1,2,translator);
        assertThat(reject(id,1,Map.of("reason","reason","comments",blocks),reviewer).getStatusCode().value()).isEqualTo(200);
        assertThat(commentCount(id)).isEqualTo(50);
        String missing=pending(translator,reviewer);
        jdbc.update("DELETE FROM translation_block WHERE translation_version_id=? AND source_seq=2",translationId(missing,1));
        error(reject(missing,1,comments(2,"exists in source only"),reviewer),400,"INVALID_REQUEST");unchanged(missing);
    }
    @Test void commentFailureAfterFirstInsertRollsBackDecisionStateAuditAndAllComments() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        doAnswer(invocation->{
            ReviewModels.CommentInput input=invocation.getArgument(2);
            if(input.seq()==2) throw new org.springframework.dao.DataAccessResourceFailureException("SECRET comment storage failure");
            return invocation.callRealMethod();
        }).when(reviewDao).insertComment(anyLong(),anyLong(),any(),any());
        error(reject(id,1,comments(1,"first",2,"SECRET second"),reviewer),503,"SERVICE_UNAVAILABLE");unchanged(id);
        reset(reviewDao);assertThat(reject(id,1,comments(1,"first",2,"second"),reviewer).getStatusCode().value()).isEqualTo(200);
    }
    @Test void concurrentCommentRejectionAndApprovalHaveExactlyOneDecision() throws Exception {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        var pool=Executors.newFixedThreadPool(2);var gate=new CountDownLatch(1);
        try {
            var rejection=pool.submit(()->{gate.await();return reject(id,1,comments(1,"comment"),reviewer);});
            var approval=pool.submit(()->{gate.await();return approve(id,1,reviewer);});gate.countDown();
            var rejected=rejection.get(10,TimeUnit.SECONDS);var approved=approval.get(10,TimeUnit.SECONDS);
            assertThat(List.of(rejected.getStatusCode().value(),approved.getStatusCode().value())).containsExactlyInAnyOrder(200,409);
            assertThat(decisions(id)).isEqualTo(1);assertThat(domainCount(id,"REVIEW_REJECTED")+domainCount(id,"REVIEW_APPROVED")).isEqualTo(1);
            assertThat(commentCount(id)).isEqualTo(rejected.getStatusCode().value()==200?1:0);
        } finally {pool.shutdownNow();}
    }
    @Test void currentAssigneesInheritCommentsAndOtherAccountsCannotReadThem() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);
        var newTranslator=identity(Role.TRANSLATOR);var newReviewer=identity(Role.REVIEWER);var reader=identity(Role.READER);
        String id=pending(translator,reviewer);reject(id,1,comments(1,"PRIVATE_COMMENT"),reviewer);
        error(get(translations(id)+"/1",newTranslator.token()),404,"NOT_FOUND");
        error(get(reviews(id)+"/1",newReviewer.token()),404,"NOT_FOUND");
        assign(id,"translator",newTranslator.id());assign(id,"reviewer",newReviewer.id());
        for(var response:List.of(get(translations(id)+"/1",translator.token()),get(reviews(id)+"/1",reviewer.token()))) {
            error(response,404,"NOT_FOUND");assertThat(response.getBody().toString()).doesNotContain("PRIVATE_COMMENT");
        }
        assertThat(get(translations(id)+"/1",newTranslator.token()).getBody().get("blockComments").get(0).get("text").textValue()).isEqualTo("PRIVATE_COMMENT");
        assertThat(get(reviews(id)+"/1",newReviewer.token()).getBody().get("blockComments").get(0).get("text").textValue()).isEqualTo("PRIVATE_COMMENT");
        for(String path:List.of(translations(id)+"/1",reviews(id)+"/1",operatorTranslations(id)+"/1")) {
            var response=get(path,reader.token());error(response,403,"FORBIDDEN");assertThat(response.getBody().toString()).doesNotContain("PRIVATE_COMMENT");
        }
        var publicList=get("/api/public/episodes",null);assertThat(publicList.getBody().toString()).doesNotContain("PRIVATE_COMMENT","blockComments");
        var publicDetail=get("/api/public/episodes/"+id,null);error(publicDetail,404,"NOT_FOUND");
        start(id,newTranslator);save(id,2,draft(1,1,"public first",2,"public second"),newTranslator);submit(id,2,2,newTranslator);approve(id,2,newReviewer);
        assertThat(request(HttpMethod.POST,operatorTranslations(id)+"/2/publish",null,operator.token()).getStatusCode().value()).isEqualTo(200);
        var published=get("/api/public/episodes/"+id,null);assertThat(published.getStatusCode().value()).isEqualTo(200);
        assertThat(published.getBody().toString()).doesNotContain("PRIVATE_COMMENT","blockComments","reason");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit' AND COLUMN_NAME IN ('body','text','reason','comments')",Integer.class)).isZero();
        // auth_audit.reason is an existing fixed reason code, not the review's free text.
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE account_id IN (?,?,?,?,?,?) AND reason LIKE '%PRIVATE_COMMENT%'",Integer.class,
                operator.id(),translator.id(),reviewer.id(),newTranslator.id(),newReviewer.id(),reader.id())).isZero();
    }
    @Test void commentRejectionRoleMatrixAndForgeryMaintainBackendAuthorization() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);var reader=identity(Role.READER);
        String id=pending(translator,reviewer);Object body=comments(1,"protected");
        error(reject(id,1,body,operator),403,"FORBIDDEN");error(reject(id,1,body,translator),403,"FORBIDDEN");error(reject(id,1,body,reader),403,"FORBIDDEN");
        error(request(HttpMethod.POST,reviews(id)+"/1/reject",body,null),401,"AUTH_REQUIRED");
        var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);headers.setBearerAuth(translator.token());headers.set("X-Role","REVIEWER");headers.set("X-User-Id",Long.toString(reviewer.id()));
        error(http.exchange(reviews(id)+"/1/reject",HttpMethod.POST,new HttpEntity<>(body,headers),JsonNode.class),403,"FORBIDDEN");
        error(reject(id,1,Map.of("reason","x","comments",List.of(),"role","REVIEWER"),reviewer),400,"INVALID_REQUEST");unchanged(id);
        assertThat(reject(id,1,body,reviewer).getStatusCode().value()).isEqualTo(200);assertThat(commentCount(id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?)",Integer.class,operator.id(),translator.id(),reader.id())).isEqualTo(4);
    }
    private void sqlError(int code,String sql,Object... args) {
        try {jdbc.update(sql,args);fail("Constraint should reject INSERT");}
        catch(org.springframework.dao.DataAccessException failure) {
            Throwable cause=failure;while(cause!=null && !(cause instanceof SQLException)) cause=cause.getCause();
            assertThat(cause).isInstanceOf(SQLException.class);assertThat(((SQLException)cause).getErrorCode()).isEqualTo(code);
        }
    }
    @Test void v32NotNullCheckUniqueForeignKeysAndRestrictAreEnforcedByRealMySql() {
        var translator=identity(Role.TRANSLATOR);var reviewer=identity(Role.REVIEWER);String id=pending(translator,reviewer);
        reject(id,1,Map.of("reason","reason"),reviewer);long version=translationId(id,1),decision=decisionId(id);
        String sql="INSERT INTO review_block_comment(review_decision_id,translation_version_id,source_seq,body,created_at) VALUES (?,?,?,?,?)";
        Object[] values={decision,version,1,"valid",java.sql.Timestamp.from(Instant.now())};
        for(int i=0;i<values.length;i++) {Object[] invalid=values.clone();invalid[i]=null;sqlError(1048,sql,invalid);}
        sqlError(3819,sql,decision,version,1,"",values[4]);sqlError(1406,sql,decision,version,1,"x".repeat(301),values[4]);
        sqlError(1452,sql,-1,version,1,"x",values[4]);sqlError(1452,sql,decision,version,99,"x",values[4]);
        sqlError(1452,sql,decision,-1,1,"x",values[4]);
        jdbc.update(sql,values);sqlError(1062,sql,values);
        sqlError(1451,"DELETE FROM review_decision WHERE id=?",decision);
        sqlError(1451,"DELETE FROM translation_block WHERE translation_version_id=? AND source_seq=1",version);
        assertThat(commentCount(id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='review_block_comment' AND IS_NULLABLE='NO'",Integer.class)).isEqualTo(6);
        var fks=jdbc.queryForList("SELECT UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='review_block_comment'");
        assertThat(fks).hasSize(2);for(var fk:fks) {assertThat(fk.get("UPDATE_RULE")).isEqualTo("RESTRICT");assertThat(fk.get("DELETE_RULE")).isEqualTo("RESTRICT");}
    }
}
