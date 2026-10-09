package com.mangabridge.bootstrap.assignment;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
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
@Import(AssignmentIntegrationTest.Fixtures.class)
class AssignmentIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @Autowired FixtureAddress address;
    @MockitoSpyBean AssignmentDao dao;
    private final Set<Long> accounts=new HashSet<>();
    private final Set<String> loginIds=new HashSet<>();
    private final Set<String> episodes=new HashSet<>();
    private Identity operator;
    private String password;
    private record Identity(long id,String token) { }
    static class FixtureAddress { volatile String current; }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao assignmentTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
        @Bean FixtureAddress assignmentFixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> assignmentFixtureFilter(FixtureAddress address) {
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter); registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    @BeforeEach void setup() {
        address.current="fixture.assignment."+UUID.randomUUID(); password=UUID.randomUUID().toString();
        operator=identity(Role.OPERATOR);
    }
    private Identity identity(Role role) {
        String loginId="test.assignment."+UUID.randomUUID(); loginIds.add(loginId);
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
        reset(dao); tracking.cleanupAudits();
        for(String id:episodes) {
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
        assertThat(body.get("error").fieldNames()).toIterable().containsExactlyInAnyOrder("code","message");
        assertThat(body.get("error").get("code").textValue()).isEqualTo(code);
        assertThat(body.get("error").get("message").textValue()).isNotBlank();
        assertThat(body.toString()).doesNotContain("jdbc:","Exception","stackTrace",password,"SECRET","password_hash","127.0.0.1",operator.token());
    }
    @Test void typesetterLoginAssignmentCandidatesAndHandoffAreEnforced() {
        Identity first=identity(Role.TYPESETTER), next=identity(Role.TYPESETTER), disabled=identity(Role.TYPESETTER);
        jdbc.update("UPDATE demo_account SET enabled=0 WHERE id=?",disabled.id());
        var current=get("/api/auth/me",first.token());
        assertThat(current.getStatusCode().value()).isEqualTo(200);
        assertThat(current.getBody().get("user").get("role").textValue()).isEqualTo("TYPESETTER");
        var candidates=get("/api/assignable-accounts?role=TYPESETTER").getBody().get("items");
        long previous=0; Set<Long> found=new HashSet<>();
        for(JsonNode item:candidates) {
            assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("id","displayName","role");
            assertThat(item.get("role").textValue()).isEqualTo("TYPESETTER");
            long account=Long.parseLong(item.get("id").textValue());assertThat(account).isGreaterThan(previous);previous=account;found.add(account);
        }
        assertThat(found).contains(first.id(),next.id()).doesNotContain(disabled.id());
        String id=create("typesetter assignment");
        var initial=get(assignments(id)).getBody();
        assertThat(initial.fieldNames()).toIterable().containsExactlyInAnyOrder("translator","reviewer","typesetter");
        assertThat(initial.get("typesetter").isNull()).isTrue();
        var saved=assign(id,"typesetter",first.id());assertThat(saved.getStatusCode().value()).isEqualTo(201);
        int count=audits(id);
        var unchanged=assign(id,"typesetter",first.id());assertThat(unchanged.getStatusCode().value()).isEqualTo(200);
        assertThat(unchanged.getBody().get("changed").booleanValue()).isFalse();
        assertThat(unchanged.getBody().get("assignedAt")).isEqualTo(saved.getBody().get("assignedAt"));assertThat(audits(id)).isEqualTo(count);
        var detail=get("/api/my/episodes/"+id,first.token());assertThat(detail.getStatusCode().value()).isEqualTo(200);
        assertThat(detail.getBody().get("assignedRole").textValue()).isEqualTo("TYPESETTER");assertThat(detail.getBody().get("source").isNull()).isTrue();
        assertThat(get("/api/my/episodes",first.token()).getBody().get("total").intValue()).isEqualTo(1);
        error(get("/api/my/episodes/"+id,next.token()),404,"NOT_FOUND");
        error(assign(id,"typesetter",disabled.id()),400,"INVALID_REQUEST");
        error(assign(id,"typesetter",operator.id()),400,"INVALID_REQUEST");
        assertThat(assign(id,"typesetter",next.id()).getStatusCode().value()).isEqualTo(200);
        error(get("/api/my/episodes/"+id,first.token()),404,"NOT_FOUND");
        assertThat(get("/api/my/episodes",first.token()).getBody().get("total").intValue()).isZero();
        assertThat(get("/api/my/episodes/"+id,next.token()).getStatusCode().value()).isEqualTo(200);
        assertThat(jdbc.queryForList("SELECT subject_account_id FROM domain_audit WHERE episode_id=? AND event='ASSIGNED' ORDER BY id",Long.class,id)).containsExactly(first.id(),next.id());
        assertThatThrownBy(()->jdbc.update("UPDATE demo_account SET role='UNKNOWN' WHERE id=?",first.id())).isInstanceOf(org.springframework.dao.DataAccessException.class);
        assertThatThrownBy(()->jdbc.update("UPDATE episode_assignment SET assignee_role='READER' WHERE episode_id=?",id)).isInstanceOf(org.springframework.dao.DataAccessException.class);
    }
    @Test void candidatesAreActiveRoleFilteredOrderedAndMinimal() {
        Identity translator=identity(Role.TRANSLATOR),disabled=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER);
        jdbc.update("UPDATE demo_account SET enabled=0 WHERE id=?",disabled.id());
        for(String role:List.of("TRANSLATOR","REVIEWER")) {
            var response=get("/api/assignable-accounts?role="+role);
            assertThat(response.getStatusCode().value()).isEqualTo(200);
            assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
            long previous=0; boolean found=false;
            for(JsonNode account:response.getBody().get("items")) {
                assertThat(account.fieldNames()).toIterable().containsExactlyInAnyOrder("id","displayName","role");
                assertThat(account.get("id").isTextual()).isTrue();
                long id=Long.parseLong(account.get("id").textValue()); assertThat(id).isGreaterThan(previous); previous=id;
                assertThat(id).isNotEqualTo(disabled.id()); assertThat(account.get("role").textValue()).isEqualTo(role);
                found|=id==(role.equals("TRANSLATOR")?translator.id():reviewer.id());
            }
            assertThat(found).isTrue();
            assertThat(response.getBody().toString()).doesNotContain("loginId","passwordHash","password_hash",password);
        }
        for(String suffix:List.of("","?role=","?role=translator","?role=READER","?role=OPERATOR","?role=REVIEWER%20"))
            error(get("/api/assignable-accounts"+suffix),400,"INVALID_REQUEST");
    }
    @Test void initialReplacementAndNoopPreserveTimestampAndAuditContract() {
        String id=create("  배정 제목  "); Identity first=identity(Role.TRANSLATOR),next=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER);
        assertThat(get(assignments(id)).getBody().get("translator").isNull()).isTrue();
        assertThat(get(assignments(id)).getBody().get("reviewer").isNull()).isTrue();
        var result=assign(id,"translator",first.id()); assertThat(result.getStatusCode().value()).isEqualTo(201);
        assertThat(result.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("role","account","assignedAt","changed");
        assertThat(result.getBody().get("account").fieldNames()).toIterable().containsExactlyInAnyOrder("id","displayName");
        assertThat(result.getBody().get("role").textValue()).isEqualTo("TRANSLATOR");
        assertThat(result.getBody().get("changed").booleanValue()).isTrue();
        Instant.parse(result.getBody().get("assignedAt").textValue());
        var before=jdbc.queryForMap("SELECT * FROM episode_assignment WHERE episode_id=?",id);
        int auditCount=audits(id); clearInvocations(dao);
        var noop=assign(id,"translator",first.id()); assertThat(noop.getStatusCode().value()).isEqualTo(200);
        assertThat(noop.getBody().get("changed").booleanValue()).isFalse();
        assertThat(noop.getBody().get("assignedAt")).isEqualTo(result.getBody().get("assignedAt"));
        assertThat(jdbc.queryForMap("SELECT * FROM episode_assignment WHERE episode_id=?",id)).isEqualTo(before);
        assertThat(audits(id)).isEqualTo(auditCount); verify(dao,never()).upsert(anyLong(),anyString(),anyLong(),anyLong(),any());
        verify(dao,never()).audit(anyLong(),anyLong(),anyLong(),any());
        assertThat(assign(id,"translator",next.id()).getStatusCode().value()).isEqualTo(200);
        assertThat(assign(id,"reviewer",reviewer.id()).getStatusCode().value()).isEqualTo(201);
        assertThat(get(assignments(id)).getBody().get("translator").get("account").get("id").textValue()).isEqualTo(Long.toString(next.id()));
        assertThat(get(assignments(id)).getBody().get("reviewer").get("account").get("id").textValue()).isEqualTo(Long.toString(reviewer.id()));
        assertThat(audits(id)).isEqualTo(3);
        assertThat(jdbc.queryForList("SELECT subject_account_id FROM domain_audit WHERE episode_id=? AND event='ASSIGNED' ORDER BY id",Long.class,id)).containsExactly(first.id(),next.id(),reviewer.id());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='ASSIGNED' AND actor_account_id=? AND source_version IS NULL AND translation_version_id IS NULL",Integer.class,id,operator.id())).isEqualTo(3);
    }
    @Test void invalidTargetsAreIdenticalAndDatabaseAlsoRejectsRoleMismatch() {
        String id=create("대상 검증"); Identity reader=identity(Role.READER),disabled=identity(Role.TRANSLATOR);
        jdbc.update("UPDATE demo_account SET enabled=0 WHERE id=?",disabled.id());
        JsonNode baseline=null;
        for(long target:List.of(reader.id(),disabled.id(),999999999999999999L)) {
            var result=assign(id,"translator",target); error(result,400,"INVALID_REQUEST");
            if(baseline==null) baseline=result.getBody(); else assertThat(result.getBody()).isEqualTo(baseline);
        }
        assertThat(audits(id)).isZero();
        assertThatThrownBy(()->jdbc.update("INSERT INTO episode_assignment(episode_id,assignee_role,account_id,assigned_by,assigned_at) VALUES (?,'TRANSLATOR',?,?,UTC_TIMESTAMP(6))",id,reader.id(),operator.id()))
            .isInstanceOf(DataIntegrityViolationException.class).satisfies(failure->{
                Throwable cause=failure; while(cause!=null && !(cause instanceof SQLException)) cause=cause.getCause();
                assertThat(cause).isInstanceOf(SQLException.class); assertThat(((SQLException)cause).getErrorCode()).isEqualTo(1452);
            });
    }
    @Test void assignedListsAndLatestSourceExcludeOtherUsersAndAuthors() {
        Identity translator=identity(Role.TRANSLATOR),other=identity(Role.TRANSLATOR),reviewer=identity(Role.REVIEWER);
        String one=create("  원문 있는 회차  "),two=create("빈 회차"),hidden=create("다른 담당자");
        assign(one,"translator",translator.id()); assign(two,"translator",translator.id()); assign(hidden,"translator",other.id()); assign(one,"reviewer",reviewer.id());
        Object blocks=Arrays.asList(Map.of("pageNo",1,"text","  원문 😀  "),Map.of("text","둘\n\t"));
        for(int version=0;version<2;version++) assertThat(request(HttpMethod.PUT,"/api/episodes/"+one+"/source",Map.of("expectedVersion",version,"blocks",version==0?List.of(Map.of("text","이전")):blocks),operator.token()).getStatusCode().value()).isEqualTo(201);
        var list=get("/api/my/episodes?limit=1",translator.token()).getBody();
        assertThat(list.get("total").intValue()).isEqualTo(2); assertThat(list.get("items").size()).isEqualTo(1);
        assertThat(list.get("items").get(0).get("id").textValue()).isEqualTo(two);
        assertThat(list.get("items").get(0).fieldNames()).toIterable().containsExactlyInAnyOrder("id","title","assignedRole","latestSourceVersion","assignedAt","updatedAt");
        assertThat(get("/api/my/episodes?limit=1&offset=1",translator.token()).getBody().get("items").get(0).get("id").textValue()).isEqualTo(one);
        assertThat(get("/api/my/episodes?offset=999999999999999999999",translator.token()).getBody().get("items").size()).isZero();
        var operatorSource=get("/api/episodes/"+one).getBody().get("source");
        for(Identity user:List.of(translator,reviewer)) {
            var response=get("/api/my/episodes/"+one,user.token()); assertThat(response.getStatusCode().value()).isEqualTo(200);
            var detail=response.getBody();
            assertThat(detail.fieldNames()).toIterable().containsExactlyInAnyOrder("id","title","assignedRole","latestSourceVersion","source");
            assertThat(detail.get("source").fieldNames()).toIterable().containsExactlyInAnyOrder("version","savedAt","blocks");
            assertThat(detail.get("source").get("version").intValue()).isEqualTo(2);
            assertThat(detail.get("source").get("blocks")).isEqualTo(operatorSource.get("blocks"));
            assertThat(detail.toString()).doesNotContain("savedBy","createdBy","accountId","loginId");
            error(get("/api/my/episodes/"+hidden,user.token()),404,"NOT_FOUND");
            error(get("/api/my/episodes/999999999999999999",user.token()),404,"NOT_FOUND");
        }
        assertThat(get("/api/my/episodes/"+two,translator.token()).getBody().get("source").isNull()).isTrue();
        for(String query:List.of("limit=0","limit=101","limit=1.5","offset=-1","offset=x"))
            error(get("/api/my/episodes?"+query,translator.token()),400,"INVALID_REQUEST");
    }
    @Test void replacementImmediatelyMovesAccessForBothAssignmentRoles() {
        String id=create("접근 이전");
        for(Role role:List.of(Role.TRANSLATOR,Role.REVIEWER,Role.TYPESETTER)) {
            Identity old=identity(role),next=identity(role); String segment=role.name().toLowerCase(Locale.ROOT);
            assign(id,segment,old.id()); assertThat(get("/api/my/episodes/"+id,old.token()).getStatusCode().value()).isEqualTo(200);
            error(get("/api/my/episodes/"+id,next.token()),404,"NOT_FOUND");
            assign(id,segment,next.id()); error(get("/api/my/episodes/"+id,old.token()),404,"NOT_FOUND");
            assertThat(get("/api/my/episodes",old.token()).getBody().get("total").intValue()).isZero();
            assertThat(get("/api/my/episodes/"+id,next.token()).getStatusCode().value()).isEqualTo(200);
        }
    }
    @Test void fourRolesAcrossFiveApisAndForgedIdentityAreEnforced() {
        String id=create("역할 매트릭스"); Identity translator=identity(Role.TRANSLATOR);
        List<HttpMethod> methods=List.of(HttpMethod.GET,HttpMethod.GET,HttpMethod.PUT,HttpMethod.GET,HttpMethod.GET);
        List<String> paths=List.of("/api/assignable-accounts?role=TRANSLATOR",assignments(id),assignments(id)+"/translator","/api/my/episodes","/api/my/episodes/"+id);
        List<Object> bodies=Arrays.asList(null,null,Map.of("accountId",Long.toString(translator.id())),null,null);
        for(int i=0;i<5;i++) error(request(methods.get(i),paths.get(i),bodies.get(i),null),401,"AUTH_REQUIRED");
        for(Role role:Role.values()) {
            Identity user=identity(role);
            if(role==Role.TRANSLATOR || role==Role.REVIEWER || role==Role.TYPESETTER) assign(id,role.name().toLowerCase(Locale.ROOT),user.id());
            int denied=0;
            for(int i=0;i<5;i++) {
                var response=request(methods.get(i),paths.get(i),bodies.get(i),user.token());
                boolean allowed=i<3?role==Role.OPERATOR:role==Role.TRANSLATOR||role==Role.REVIEWER||role==Role.TYPESETTER;
                if(allowed) { assertThat(response.getStatusCode().value()).isEqualTo(i==2?201:200); assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store"); }
                else { error(response,403,"FORBIDDEN"); denied++; }
            }
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE account_id=? AND event='ACCESS_DENIED'",Integer.class,user.id())).isEqualTo(denied);
        }
        Identity reader=identity(Role.READER);
        HttpHeaders forged=new HttpHeaders(); forged.setBearerAuth(reader.token()); forged.set("X-Role","TRANSLATOR"); forged.set("X-User-Id",Long.toString(translator.id()));
        error(http.exchange("/api/my/episodes",HttpMethod.GET,new HttpEntity<>(forged),JsonNode.class),403,"FORBIDDEN");
        forged.set("X-Role","OPERATOR"); forged.setContentType(MediaType.APPLICATION_JSON);
        error(http.exchange(assignments(id)+"/translator",HttpMethod.PUT,new HttpEntity<>(Map.of("accountId",Long.toString(reader.id()),"role","OPERATOR"),forged),JsonNode.class),403,"FORBIDDEN");
        error(request(HttpMethod.PUT,assignments(id)+"/translator",Map.of("accountId",Long.toString(translator.id()),"role","TRANSLATOR"),operator.token()),400,"INVALID_REQUEST");
        var mine=get("/api/my/episodes?accountId="+operator.id()+"&role=OPERATOR",translator.token());
        assertThat(mine.getBody().get("total").intValue()).isZero(); // server principal, never supplied IDs
    }
    @Test void strictIdsBodiesAndNonJsonErrorsDoNotWrite() {
        String id=create("요청 검증"); Identity translator=identity(Role.TRANSLATOR);
        for(String invalid:List.of("0","01","-1","abc","1.2","1000000000000000000")) {
            error(get(assignments(invalid)),404,"NOT_FOUND");
            error(assign(invalid,"translator",translator.id()),404,"NOT_FOUND");
            error(get("/api/my/episodes/"+invalid,translator.token()),404,"NOT_FOUND");
        }
        for(String role:List.of("TRANSLATOR","reader","operator","x")) error(assign(id,role,translator.id()),404,"NOT_FOUND");
        error(get(assignments("999999999999999999")),404,"NOT_FOUND");
        error(assign("999999999999999999","translator",translator.id()),404,"NOT_FOUND");
        String path=assignments(id)+"/translator";
        for(Object value:List.of(translator.id(),0,true,"0","01","-1"," ","9999999999999999999"))
            error(request(HttpMethod.PUT,path,Map.of("accountId",value),operator.token()),400,"INVALID_REQUEST");
        for(Object body:Arrays.asList(null,Map.of(),Map.of("accountId",Long.toString(translator.id()),"userId","1")))
            error(request(HttpMethod.PUT,path,body,operator.token()),400,"INVALID_REQUEST");
        for(MediaType type:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED,MediaType.APPLICATION_JSON)) {
            HttpHeaders headers=new HttpHeaders(); headers.setBearerAuth(operator.token()); headers.setContentType(type);
            error(http.exchange(path,HttpMethod.PUT,new HttpEntity<>("{broken SECRET",headers),JsonNode.class),400,"INVALID_REQUEST");
        }
        assertThat(audits(id)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM episode_assignment WHERE episode_id=?",Integer.class,id)).isZero();
        assertThat(request(HttpMethod.DELETE,path,null,operator.token()).getStatusCode().value()).isEqualTo(405);
    }
    @Test void auditFailureRollsBackNewAndReplacementAssignments() {
        String id=create("원자 배정"); Identity first=identity(Role.TRANSLATOR),next=identity(Role.TRANSLATOR);
        doThrow(new DataIntegrityViolationException("SECRET database exception")).when(dao).audit(anyLong(),anyLong(),anyLong(),any());
        error(assign(id,"translator",first.id()),503,"SERVICE_UNAVAILABLE");
        assertThat(get(assignments(id)).getBody().get("translator").isNull()).isTrue(); assertThat(audits(id)).isZero();
        reset(dao); assign(id,"translator",first.id());
        var before=get(assignments(id)).getBody();
        doThrow(new DataIntegrityViolationException("SECRET database exception")).when(dao).audit(anyLong(),anyLong(),anyLong(),any());
        error(assign(id,"translator",next.id()),503,"SERVICE_UNAVAILABLE");
        assertThat(get(assignments(id)).getBody()).isEqualTo(before); assertThat(audits(id)).isEqualTo(1);
        assertThat(get("/api/my/episodes/"+id,first.token()).getStatusCode().value()).isEqualTo(200);
        error(get("/api/my/episodes/"+id,next.token()),404,"NOT_FOUND");
    }
    @Test void concurrentReplacementsBothCommitOneSlotAndTwoAudits() throws Exception {
        String id=create("동시 교체"); Identity first=identity(Role.TRANSLATOR),next=identity(Role.TRANSLATOR),last=identity(Role.TRANSLATOR);
        assign(id,"translator",first.id());
        var pool=Executors.newFixedThreadPool(2); var ready=new CountDownLatch(2); var start=new CountDownLatch(1);
        try {
            List<Future<Integer>> jobs=new ArrayList<>();
            for(Identity target:List.of(next,last)) jobs.add(pool.submit(()->{ready.countDown();start.await();return assign(id,"translator",target.id()).getStatusCode().value();}));
            assertThat(ready.await(5,TimeUnit.SECONDS)).isTrue(); start.countDown();
            assertThat(List.of(jobs.get(0).get(20,TimeUnit.SECONDS),jobs.get(1).get(20,TimeUnit.SECONDS))).containsExactly(200,200);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM episode_assignment WHERE episode_id=?",Integer.class,id)).isEqualTo(1);
            assertThat(audits(id)).isEqualTo(3);
            long finalSubject=jdbc.queryForObject("SELECT subject_account_id FROM domain_audit WHERE episode_id=? AND event='ASSIGNED' ORDER BY id DESC LIMIT 1",Long.class,id);
            assertThat(finalSubject).isIn(next.id(),last.id());
            assertThat(jdbc.queryForObject("SELECT account_id FROM episode_assignment WHERE episode_id=?",Long.class,id)).isEqualTo(finalSubject);
        } finally {start.countDown();pool.shutdownNow();}
    }
    @Test void actualDatabaseConnectionFailureIsSafe503AndCorsIsUnchanged() throws Exception {
        int unavailable; try(var socket=new ServerSocket(0)) {unavailable=socket.getLocalPort();}
        var broken=new DriverManagerDataSource("jdbc:mysql://127.0.0.1:"+unavailable+"/unavailable?connectTimeout=2000&socketTimeout=3000","unused","unused");
        var disconnected=new AssignmentDao(new JdbcTemplate(broken));
        doAnswer(invocation->disconnected.candidates("TRANSLATOR")).when(dao).candidates("TRANSLATOR");
        error(get("/api/assignable-accounts?role=TRANSLATOR"),503,"SERVICE_UNAVAILABLE");
        HttpHeaders headers=new HttpHeaders(); headers.setOrigin("http://localhost:3000"); headers.setAccessControlRequestMethod(HttpMethod.PUT);
        headers.setAccessControlRequestHeaders(List.of("Content-Type","Authorization"));
        var preflight=http.exchange("/api/episodes/1/assignments/translator",HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
        assertThat(preflight.getStatusCode().value()).isEqualTo(200);
        assertThat(preflight.getHeaders().getAccessControlAllowOrigin()).isEqualTo("http://localhost:3000");
        assertThat(preflight.getHeaders().getAccessControlAllowMethods()).contains(HttpMethod.PUT);
        assertThat(preflight.getHeaders().getAccessControlAllowHeaders()).contains("Content-Type","Authorization");
        assertThat(preflight.getHeaders().getFirst("Access-Control-Allow-Credentials")).isNull();
    }
}
