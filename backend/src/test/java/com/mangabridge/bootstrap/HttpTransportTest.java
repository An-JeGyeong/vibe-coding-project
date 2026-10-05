package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.config.CorsConfig;
import com.mangabridge.bootstrap.health.HealthController;
import com.mangabridge.bootstrap.health.HealthService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.autoconfigure.flyway.FlywayAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.HttpMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

// Real HTTP transport, mocked DB only; never counts as a real MySQL test.
@SpringBootTest(classes = HttpTransportTest.TestApplication.class,
        webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "app.cors-allowed-origins=http://localhost:3000")
class HttpTransportTest {
    @Configuration
    @EnableAutoConfiguration(exclude = {DataSourceAutoConfiguration.class, FlywayAutoConfiguration.class})
    @Import({HealthController.class, HealthService.class, CorsConfig.class})
    static class TestApplication { }

    @MockitoBean JdbcTemplate jdbc;
    @Autowired TestRestTemplate http;

    @Test void defaultHeadHasNoBodyAndMatchesGetForBothStates() {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        verifyHead(200);
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenThrow(new DataAccessResourceFailureException("private"));
        verifyHead(503);
    }

    private void verifyHead(int expectedStatus) {
        var get = http.getForEntity("/api/health", String.class);
        var head = http.exchange("/api/health", HttpMethod.HEAD, null, String.class);
        assertThat(get.getStatusCode().value()).isEqualTo(expectedStatus);
        assertThat(head.getStatusCode()).isEqualTo(get.getStatusCode());
        assertThat(head.getBody()).isNull();
        assertThat(head.getHeaders().getCacheControl()).isEqualTo("no-store");
        assertThat(head.getHeaders().getContentType()).isEqualTo(get.getHeaders().getContentType());
    }

    @Test void actual405ErrorHasNoInternalMessageOrStacktrace() {
        var response = http.postForEntity("/api/health", null, String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(405);
        assertThat(response.getBody()).doesNotContain("message", "trace", "exception", "jdbc:", "Exception", "3.5.16");
    }
}
