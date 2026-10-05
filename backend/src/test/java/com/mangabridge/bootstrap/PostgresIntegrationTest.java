package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.config.RequiredEnvironment;
import com.mangabridge.bootstrap.health.HealthController;
import com.mangabridge.bootstrap.health.HealthService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ContextConfiguration;
import static org.assertj.core.api.Assertions.*;

// Explicit task: gradlew.bat integrationTest. Requires a REAL PostgreSQL, fails if unavailable.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers = RequiredEnvironment.class)
class PostgresIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;

    @Test void postgresHealthAndBaseline() {
        ResponseEntity<HealthController.HealthResponse> response = http.getForEntity("/api/health", HealthController.HealthResponse.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().db()).isEqualTo("UP");
        assertThat(response.getBody().status()).isEqualTo("UP");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        java.time.Instant.parse(response.getBody().time());
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("1");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success", Integer.class)).isEqualTo(1);
        String body = http.getForObject("/api/health", String.class);
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(response.getBody()).size()).isEqualTo(3);
        assertSafe(body);
        assertThat(http.exchange("/api/health", HttpMethod.HEAD, null, String.class).getBody()).isNull();
    }

    @Test void realConnectionFailureIsBoundedAnd503() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://127.0.0.1:1/unavailable");
        config.setUsername("unavailable_user");
        config.setPassword("local_test_only");
        config.setConnectionTimeout(2000);
        config.setInitializationFailTimeout(-1);
        config.addDataSourceProperty("connectTimeout", "2");
        config.addDataSourceProperty("socketTimeout", "2");
        try (HikariDataSource source = new HikariDataSource(config)) {
            JdbcTemplate template = new JdbcTemplate(source);
            template.setQueryTimeout(2);
            HealthController controller = new HealthController(new HealthService(template));
            assertTimeout(controller);
        }
    }

    @Test void frameworkErrorDoesNotExposeDetails() {
        var response = http.postForEntity("/api/health", null, String.class);
        assertThat(response.getStatusCode().value()).isEqualTo(405);
        assertThat(response.getBody()).doesNotContain("message", "trace", "exception");
        assertSafe(response.getBody());
    }

    private void assertTimeout(HealthController controller) {
        org.junit.jupiter.api.Assertions.assertTimeoutPreemptively(Duration.ofSeconds(15), () -> {
            var response = controller.health();
            assertThat(response.getStatusCode().value()).isEqualTo(503);
            assertThat(response.getBody().db()).isEqualTo("DOWN");
            assertThat(response.getBody().status()).isEqualTo("UP");
            assertSafe(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(response.getBody()));
        });
    }

    private void assertSafe(String body) {
        assertThat(body).doesNotContain("jdbc:", "localhost", "127.0.0.1", "unavailable_user", "Exception", "Spring", "Java", "3.5.16");
        if (System.getenv("DB_USERNAME") != null) assertThat(body).doesNotContain(System.getenv("DB_USERNAME"));
    }
}
