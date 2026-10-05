package com.mangabridge.bootstrap.auth;

import static org.assertj.core.api.Assertions.*;
import static com.mangabridge.bootstrap.auth.AuthModels.*;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.Filter;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.web.bind.annotation.*;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(DemoAuthIntegrationTest.Fixtures.class)
class DemoAuthIntegrationTest {
    @Autowired TestRestTemplate http; @Autowired JdbcTemplate jdbc; @Autowired PasswordEncoder encoder;
    @Autowired AuthService service; @Autowired AuthDao dao; @Autowired MutableClock clock;
    @Autowired FixtureAddress fixtureAddress;
    private final List<Long> accounts=new ArrayList<>();
    private final Set<String> loginIds=ConcurrentHashMap.newKeySet();
    private final Set<String> addresses=ConcurrentHashMap.newKeySet();
    private String id; private String password;
    @TestConfiguration static class Fixtures {
        @Bean @Primary MutableClock testClock() { return new MutableClock(); }
        @Bean OperatorFixture operatorFixture() { return new OperatorFixture(); }
        @Bean FixtureAddress fixtureAddress() { return new FixtureAddress(); }
        @Bean FilterRegistrationBean<Filter> fixtureAddressFilter(FixtureAddress address) {
            // Test-only server-side identity: never trust a header or mutate the shared loopback key.
            Filter filter=(request,response,chain)->chain.doFilter(new HttpServletRequestWrapper((HttpServletRequest)request) {
                @Override public String getRemoteAddr() { return address.current; }
            },response);
            var registration=new FilterRegistrationBean<>(filter);
            registration.setOrder(Ordered.HIGHEST_PRECEDENCE);
            return registration;
        }
    }
    static class FixtureAddress { volatile String current; }
    // Only in src/test. It is never packaged into bootJar.
    @RestController static class OperatorFixture {
        @GetMapping("/__test/operator") @PreAuthorize("hasRole('OPERATOR')")
        String operator() { return "allowed"; }
    }
    static class MutableClock extends Clock {
        volatile Instant now=Instant.now();
        @Override public ZoneId getZone() {return ZoneOffset.UTC;}
        @Override public Clock withZone(ZoneId zone) {return this;}
        @Override public Instant instant() {return now;}
    }
    @BeforeEach void setup() {
        clock.now=Instant.now(); id="test."+UUID.randomUUID().toString(); password=UUID.randomUUID().toString();
        fixtureAddress.current=address();
        account(id,Role.READER);
    }
    private long account(String loginId,Role role) {
        dao.insertAccount(loginId,"검증 계정",role,encoder.encode(password));
        loginIds.add(loginId);
        long accountId=dao.account(loginId).id(); accounts.add(accountId); return accountId;
    }
    @AfterEach void cleanup() {
        for(Long accountId:accounts) {
            jdbc.update("DELETE FROM auth_token WHERE account_id=?",accountId);
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?",accountId);
            jdbc.update("DELETE FROM demo_account WHERE id=?",accountId);
        }
        for(String loginId:loginIds) deleteLimit("id:"+loginId);
        for(String address:addresses) deleteLimit("ip:"+address);
    }
    private void deleteLimit(String input) {
        byte[] key=AuthService.hash(input);
        jdbc.update("DELETE FROM auth_login_limit WHERE limit_key=?",key);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_login_limit WHERE limit_key=?",Integer.class,key)).isZero();
    }
    private String address() {
        String address="fixture."+UUID.randomUUID();
        addresses.add(address); return address;
    }
    private String missingId() {
        String missing="missing."+UUID.randomUUID();
        loginIds.add(missing); return missing;
    }
    private ResponseEntity<Map> login(String loginId,String pass) {
        return http.postForEntity("/api/auth/login",new LoginRequest(loginId,pass),Map.class);
    }
    private String token(ResponseEntity<Map> response) {
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        return (String)response.getBody().get("accessToken");
    }
    private ResponseEntity<String> call(String path,HttpMethod method,String token) {
        HttpHeaders headers=new HttpHeaders(); if(token!=null) headers.setBearerAuth(token);
        return http.exchange(path,method,new HttpEntity<>(headers),String.class);
    }
    @Test void loginMeLogoutAndIndependentTokens() {
        var first=login(id,password); String one=token(first),two=token(login(id,password));
        assertThat(one.length()==43).isTrue(); assertThat(!one.equals(two)).isTrue();
        assertThat(first.getHeaders().getCacheControl()).isEqualTo("no-store");
        var me=call("/api/auth/me",HttpMethod.GET,one);
        assertThat(me.getStatusCode().value()).isEqualTo(200);
        assertThat(me.getBody()).contains("READER","expiresAt").doesNotContain("password","accessToken","jdbc:");
        assertThat(jdbc.queryForObject("SELECT LENGTH(token_hash) FROM auth_token WHERE token_hash=?",Integer.class,AuthService.hash(one))).isEqualTo(32);
        assertThat(call("/api/auth/logout",HttpMethod.POST,one).getStatusCode().value()).isEqualTo(204);
        assertThat(call("/api/auth/logout",HttpMethod.POST,one).getStatusCode().value()).isEqualTo(204);
        assertThat(call("/api/auth/logout",HttpMethod.POST,null).getStatusCode().value()).isEqualTo(204);
        assertThat(call("/api/auth/me",HttpMethod.GET,one).getStatusCode().value()).isEqualTo(401);
        assertThat(call("/api/auth/me",HttpMethod.GET,two).getStatusCode().value()).isEqualTo(200);
    }
    @Test void expirationAndDatabaseRoleAreAuthoritative() {
        String token=token(login(id,password));
        Instant expires=Instant.parse((String)login(id,password).getBody().get("expiresAt"));
        clock.now=expires.minusNanos(1000);
        assertThat(call("/api/auth/me",HttpMethod.GET,token).getStatusCode().value()).isEqualTo(200);
        clock.now=expires;
        assertThat(call("/api/auth/me",HttpMethod.GET,token).getStatusCode().value()).isEqualTo(401);
        assertThat(call("/api/auth/logout",HttpMethod.POST,token).getStatusCode().value()).isEqualTo(204);
        clock.now=Instant.now(); token=token(login(id,password));
        jdbc.update("UPDATE demo_account SET enabled=FALSE WHERE login_id=?",id);
        assertThat(call("/api/auth/me",HttpMethod.GET,token).getStatusCode().value()).isEqualTo(401);
    }
    @Test void actualRoleEnforcementAndClientForgery() {
        assertThat(call("/__test/operator",HttpMethod.GET,null).getStatusCode().value()).isEqualTo(401);
        String reader=token(login(id,password));
        HttpHeaders forged=new HttpHeaders(); forged.setBearerAuth(reader); forged.set("X-Role","OPERATOR"); forged.set("X-User-Id","1");
        var denied=http.exchange("/__test/operator",HttpMethod.GET,new HttpEntity<>(forged),String.class);
        assertThat(denied.getStatusCode().value()).isEqualTo(403);
        assertThat(denied.getBody()).contains("FORBIDDEN");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM auth_audit WHERE account_id=? AND event='ACCESS_DENIED'",Integer.class,accounts.get(0))).isEqualTo(1);
        for(Role role:Role.values()) {
            String loginId="test."+UUID.randomUUID(); account(loginId,role);
            assertThat(call("/__test/operator",HttpMethod.GET,token(login(loginId,password))).getStatusCode().value()).isEqualTo(role==Role.OPERATOR?200:403);
        }
        var forgedBody=http.postForEntity("/api/auth/login",Map.of("loginId",id,"password",password,"role","OPERATOR"),String.class);
        assertThat(forgedBody.getStatusCode().value()).isEqualTo(400);
    }
    @Test void failedLoginIsUniformAndLimitBoundariesReset() {
        var unknown=login(missingId(),"wrong"); var wrong=login(id,"wrong");
        assertThat(unknown.getStatusCode().value()).isEqualTo(401);
        assertThat(unknown.getBody()).isEqualTo(wrong.getBody());
        for(int i=0;i<4;i++) assertThat(login(id,"wrong").getStatusCode().value()).isEqualTo(401);
        var blocked=login(id,password); assertThat(blocked.getStatusCode().value()).isEqualTo(429);
        assertThat(blocked.getHeaders().getFirst("Retry-After")).isEqualTo("900");
        clock.now=clock.now.plusSeconds(899);
        assertThat(login(id,password).getStatusCode().value()).isEqualTo(429);
        clock.now=clock.now.plusSeconds(1);
        token(login(id,password));
        assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,AuthService.hash("id:"+id))).isZero();
    }
    @Test void simultaneousFailuresAreAtomic() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(4);
        try {
            List<Callable<Integer>> jobs=new ArrayList<>();
            for(int i=0;i<8;i++) { final String ip=address(); jobs.add(()->{
                try { service.loginDemoAccount(new LoginRequest(id,"wrong"),ip); return 200; }
                catch(AuthFailure failure) {return failure.status;}
            }); }
            List<Integer> codes=new ArrayList<>(); for(Future<Integer> f:pool.invokeAll(jobs)) codes.add(f.get(20,TimeUnit.SECONDS));
            assertThat(codes.stream().filter(c->c==401).count()).isEqualTo(5);
            assertThat(codes.stream().filter(c->c==429).count()).isEqualTo(3);
            assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,AuthService.hash("id:"+id))).isEqualTo(5);
        } finally {pool.shutdownNow();}
    }
    @Test void ipLimitIsIndependentAndSuccessOnlyClearsId() {
        String address=address(); byte[] ipKey=AuthService.hash("ip:"+address);
        var now=java.sql.Timestamp.from(clock.now);
        jdbc.update("INSERT INTO auth_login_limit(limit_key,failures,window_start,updated_at) VALUES (?,29,?,?)",ipKey,now,now);
        String missing=missingId();
        assertThatThrownBy(()->service.loginDemoAccount(new LoginRequest(missing,"wrong"),address))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(401));
        assertThatThrownBy(()->service.loginDemoAccount(new LoginRequest(id,password),address))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(429));
        clock.now=clock.now.plusSeconds(900);
        service.loginDemoAccount(new LoginRequest(id,password),address);
        assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,ipKey)).isZero();
        assertThatThrownBy(()->service.loginDemoAccount(new LoginRequest(id,"wrong"),address)).isInstanceOf(AuthFailure.class);
        service.loginDemoAccount(new LoginRequest(id,password),address);
        assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,ipKey)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,AuthService.hash("id:"+id))).isZero();
    }
    @Test void corsBearerOnlyAndMalformedLogout() {
        HttpHeaders headers=new HttpHeaders(); headers.setOrigin("http://localhost:3000");
        headers.setAccessControlRequestMethod(HttpMethod.GET); headers.setAccessControlRequestHeaders(List.of("Authorization"));
        var allowed=http.exchange("/api/auth/me",HttpMethod.OPTIONS,new HttpEntity<>(headers),String.class);
        assertThat(allowed.getStatusCode().value()).isEqualTo(200);
        assertThat(allowed.getHeaders().getAccessControlAllowHeaders()).contains("Authorization");
        assertThat(allowed.getHeaders().getAccessControlExposeHeaders()).contains("Retry-After");
        assertThat(allowed.getHeaders().getFirst("Access-Control-Allow-Credentials")).isNull();
        headers.setOrigin("https://unapproved.example");
        assertThat(http.exchange("/api/auth/me",HttpMethod.GET,new HttpEntity<>(headers),String.class).getStatusCode().value()).isEqualTo(403);
        HttpHeaders malformed=new HttpHeaders(); malformed.set("Authorization","Bearer short");
        assertThat(http.exchange("/api/auth/logout",HttpMethod.POST,new HttpEntity<>(malformed),String.class).getStatusCode().value()).isEqualTo(400);
        HttpHeaders cookie=new HttpHeaders(); cookie.set("Cookie","JSESSIONID=forged");
        assertThat(http.exchange("/api/auth/me",HttpMethod.GET,new HttpEntity<>(cookie),String.class).getStatusCode().value()).isEqualTo(401);
        assertThat(login(" Demo.operator",password).getStatusCode().value()).isEqualTo(400);
    }
    @Test void unsupportedLoginMediaTypesDoNotChangeLimitsOrLeakDetails() {
        assertThat(login(id,"wrong").getStatusCode().value()).isEqualTo(401);
        byte[] idKey=AuthService.hash("id:"+id),ipKey=AuthService.hash("ip:"+fixtureAddress.current);
        for(MediaType mediaType:List.of(MediaType.TEXT_PLAIN,MediaType.APPLICATION_FORM_URLENCODED)) {
            HttpHeaders headers=new HttpHeaders(); headers.setContentType(mediaType);
            var response=http.exchange("/api/auth/login",HttpMethod.POST,
                    new HttpEntity<>("loginId="+id+"&password="+password,headers),Map.class);
            assertThat(response.getStatusCode().value()).isEqualTo(400);
            assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
            assertThat(response.getBody()).isEqualTo(Map.of("error",Map.of(
                    "code","INVALID_REQUEST","message","요청 형식을 확인하세요.")));
            for(byte[] key:List.of(idKey,ipKey)) {
                assertThat(jdbc.queryForObject("SELECT failures FROM auth_login_limit WHERE limit_key=?",Integer.class,key)).isEqualTo(1);
            }
        }
    }
    @Test void unsupportedMethodsKeepExistingStatuses() {
        assertThat(call("/api/auth/login",HttpMethod.GET,null).getStatusCode().value()).isEqualTo(405);
        assertThat(call("/api/auth/me",HttpMethod.POST,null).getStatusCode().value()).isEqualTo(401);
    }
}
