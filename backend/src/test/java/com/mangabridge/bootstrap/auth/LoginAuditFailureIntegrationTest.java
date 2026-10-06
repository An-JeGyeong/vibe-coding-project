package com.mangabridge.bootstrap.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static com.mangabridge.bootstrap.auth.AuthModels.*;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(DemoAuthIntegrationTest.Fixtures.class)
class LoginAuditFailureIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @MockitoSpyBean TrackingAuthDao audited;
    private Long accountId;

    @AfterEach void cleanup() {
        reset(audited);
        audited.cleanupAudits();
        if(accountId!=null) {
            jdbc.update("DELETE FROM auth_token WHERE account_id=?",accountId);
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?",accountId);
            jdbc.update("DELETE FROM demo_account WHERE id=?",accountId);
        }
    }

    @Test void failedAndSuccessfulLoginAuditFaultsReturn503AndRollBackRealDatabase() {
        String id="test."+UUID.randomUUID(),password=UUID.randomUUID().toString();
        audited.insertAccount(id,"audit fault fixture",Role.READER,encoder.encode(password));
        accountId=audited.account(id).id();
        int before=jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit",Integer.class);
        doThrow(new DataAccessResourceFailureException("private audit failure"))
                .when(audited).audit(any(),anyString(),anyString(),any());
        for(String input:new String[]{"wrong",password}) {
            var response=http.postForEntity("/api/auth/login",new LoginRequest(id,input),Map.class);
            assertThat(response.getStatusCode().value()).isEqualTo(503);
            assertThat(response.getBody()).isEqualTo(Map.of("error",Map.of(
                    "code","AUTH_UNAVAILABLE","message","인증 서비스를 사용할 수 없습니다. 다시 시도하세요.")));
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_token WHERE account_id=?",Integer.class,accountId)).isZero();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit",Integer.class)).isEqualTo(before);
        }
    }
}
