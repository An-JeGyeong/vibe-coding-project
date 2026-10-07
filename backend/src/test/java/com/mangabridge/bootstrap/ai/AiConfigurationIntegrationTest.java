package com.mangabridge.bootstrap.ai;

import static org.assertj.core.api.Assertions.*;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.test.context.*;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties={"AI_PROVIDER=anthropic","AI_API_KEY=","AI_TIMEOUT_SECONDS=0","AI_MAX_OUTPUT_TOKENS=8193"})
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
class AiConfigurationIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired AiSettings settings;
    @Test void invalidAiConfigurationDoesNotPreventRealApplicationStartupOrDatabaseHealth() {
        assertThat(http.getForEntity("/api/health",String.class).getStatusCode().value()).isEqualTo(200);
        assertThatThrownBy(settings::configuration).isInstanceOfSatisfying(AiFailure.class,failure->{
            assertThat(failure.status).isEqualTo(503);assertThat(failure.code).isEqualTo("AI_UNAVAILABLE");
        });
    }
}
