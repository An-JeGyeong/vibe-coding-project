package com.mangabridge.bootstrap.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static com.mangabridge.bootstrap.auth.AuthModels.*;
import java.time.Clock;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.CannotCreateTransactionException;

class AuthUnitTest {
    @Test void auditFailureRollsBackFailedLoginAndLogout() {
        AuthDao dao=mock(AuthDao.class); PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
        var status=new org.springframework.transaction.support.SimpleTransactionStatus();
        when(manager.getTransaction(any())).thenReturn(status);
        when(dao.lockLimit(any(),any())).thenAnswer(call->new AuthDao.Limit(call.getArgument(0),0,call.getArgument(1),null));
        doThrow(new DataAccessResourceFailureException("private audit detail")).when(dao).audit(any(),anyString(),anyString(),any());
        AuthService service=new AuthService(dao,new BCryptPasswordEncoder(4),Clock.systemUTC(),3600,manager);
        assertThatThrownBy(()->service.loginDemoAccount(new LoginRequest("valid.id","wrong"),"127.0.0.1"))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
        verify(manager).rollback(status); verify(manager,never()).commit(any());
        when(dao.revoke(any(),any())).thenReturn(1L);
        assertThatThrownBy(()->service.logout("a".repeat(43))).satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
        verify(manager,times(2)).rollback(status);
        assertThatThrownBy(()->service.accessDenied(new CurrentUser(new User("1","reader",Role.READER),java.time.Instant.now())))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
        verify(manager,times(3)).rollback(status);
    }
    @Test void seedIsExplicitAndNeverOverwritesAnExistingAccount() {
        AuthDao dao=mock(AuthDao.class); PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        MockEnvironment env=new MockEnvironment(); env.setActiveProfiles("local");
        var encoder=new BCryptPasswordEncoder(4);
        var commands=new DemoAuthCommands(dao,encoder,Clock.systemUTC(),env,manager,mock(org.springframework.context.ConfigurableApplicationContext.class));
        assertThatThrownBy(commands::seed).isInstanceOf(IllegalStateException.class);
        env.setProperty("DEMO_AUTH_SEED_ENABLED","true");
        for(Role role:Role.values()) env.setProperty("DEMO_"+role+"_PASSWORD","private-test-password");
        when(dao.account("demo.operator")).thenReturn(new Account(1,"데모 운영자",Role.OPERATOR,encoder.encode("different"),true));
        assertThatThrownBy(commands::seed).isInstanceOf(IllegalStateException.class);
        verify(dao,never()).insertAccount(any(),any(),any(),any());
        env.setActiveProfiles("prod");
        assertThatThrownBy(commands::seed).isInstanceOf(IllegalStateException.class);
    }
    @Test void seedCreatesAllRolesAndMatchingAccountsAreIdempotent() {
        AuthDao dao=mock(AuthDao.class); PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new org.springframework.transaction.support.SimpleTransactionStatus());
        MockEnvironment env=new MockEnvironment(); env.setActiveProfiles("local"); env.setProperty("DEMO_AUTH_SEED_ENABLED","true");
        String password=java.util.UUID.randomUUID().toString();
        for(Role role:Role.values()) env.setProperty("DEMO_"+role+"_PASSWORD",password);
        var encoder=new BCryptPasswordEncoder(4);
        var commands=new DemoAuthCommands(dao,encoder,Clock.systemUTC(),env,manager,mock(org.springframework.context.ConfigurableApplicationContext.class));
        commands.seed(); verify(dao,times(4)).insertAccount(anyString(),anyString(),any(),anyString());
        clearInvocations(dao);
        String[] names={"데모 운영자","데모 번역가","데모 감수자","데모 독자"};
        for(Role role:Role.values()) when(dao.account("demo."+role.name().toLowerCase(java.util.Locale.ROOT)))
                .thenReturn(new Account(1,names[role.ordinal()],role,encoder.encode(password),true));
        commands.seed(); verify(dao,never()).insertAccount(anyString(),anyString(),any(),anyString());
    }
    @Test void inputIsExactWithoutNormalization() {
        for(String id:List.of(" demo.operator","Demo.operator","demo.operator ","ab","한글계정"))
            assertThatThrownBy(()->AuthService.validate(new LoginRequest(id,"valid"))).isInstanceOf(AuthFailure.class);
        AuthService.validate(new LoginRequest("demo.operator","  meaningful space  "));
        assertThatThrownBy(()->AuthService.validate(new LoginRequest("demo.operator","가".repeat(25)))).isInstanceOf(AuthFailure.class);
        assertThatThrownBy(()->AuthService.validate(new LoginRequest("demo.operator",""))).isInstanceOf(AuthFailure.class);
        assertThat(new LoginRequest("demo.operator","sensitive").toString()).doesNotContain("sensitive");
    }
    @Test void tokenAndHeaderRules() {
        String token="a".repeat(43);
        assertThat(AuthService.bearer("Bearer "+token,false)).isEqualTo(token);
        assertThat(AuthService.bearer(null,true)).isNull();
        for(String header:List.of("Basic abc","Bearer short","Bearer "+token+" ","Bearer "+token+",Bearer "+token)) {
            assertThatThrownBy(()->AuthService.bearer(header,true)).satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(400));
            assertThatThrownBy(()->AuthService.bearer(header,false)).satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(401));
        }
        assertThat(AuthService.hash(token)).hasSize(32);
    }
    @Test void localIpAndFiniteLifetimeAreRequired() {
        MockEnvironment env=new MockEnvironment(); env.setActiveProfiles("local");
        assertThat(new AuthSettings().authTokenTtl(env)).isEqualTo(3600);
        for(String ttl:List.of("0","86401","infinite")) {
            env.setProperty("AUTH_TOKEN_TTL_SECONDS",ttl);
            assertThatThrownBy(()->new AuthSettings().authTokenTtl(env)).isInstanceOf(IllegalStateException.class);
        }
        env.setProperty("AUTH_TOKEN_TTL_SECONDS","3600"); env.setActiveProfiles("demo");
        assertThatThrownBy(()->new AuthSettings().authTokenTtl(env)).hasMessageContaining("IP policy");
    }
    @Test void databaseAndDeniedAuditFailureCannotAllowAccess() {
        AuthDao dao=mock(AuthDao.class); PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
        when(dao.current(any(),any())).thenThrow(new DataAccessResourceFailureException("private"));
        AuthService service=new AuthService(dao,new BCryptPasswordEncoder(4),Clock.systemUTC(),3600,manager);
        assertThatThrownBy(()->service.getCurrentUser("a".repeat(43)))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503)).hasMessageNotContaining("private");
        when(manager.getTransaction(any())).thenThrow(new CannotCreateTransactionException("private"));
        assertThatThrownBy(()->service.logout("a".repeat(43))).satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
        assertThatThrownBy(()->service.accessDenied(new CurrentUser(new User("1","name",Role.READER),java.time.Instant.now())))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
        assertThatThrownBy(()->service.loginDemoAccount(new LoginRequest("valid.id","password"),"127.0.0.1"))
                .satisfies(e->assertThat(((AuthFailure)e).status).isEqualTo(503));
    }
}
