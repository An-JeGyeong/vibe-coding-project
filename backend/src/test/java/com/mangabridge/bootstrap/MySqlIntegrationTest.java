package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.config.RequiredEnvironment;
import com.mangabridge.bootstrap.health.HealthController;
import com.mangabridge.bootstrap.health.HealthService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import javax.sql.DataSource;
import org.springframework.test.context.ContextConfiguration;
import static org.assertj.core.api.Assertions.*;

// Explicit task: gradlew.bat integrationTest. Requires a REAL MySQL 8.4, fails if unavailable.
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers = RequiredEnvironment.class)
class MySqlIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @Autowired DataSource source;

    @Test void mysqlHealthAndBaseline() {
        ResponseEntity<HealthController.HealthResponse> response = http.getForEntity("/api/health", HealthController.HealthResponse.class);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getBody().db()).isEqualTo("UP");
        assertThat(response.getBody().status()).isEqualTo("UP");
        assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        java.time.Instant.parse(response.getBody().time());
        assertThat(flyway.info().current().getVersion().getVersion()).isEqualTo("38");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM flyway_schema_history WHERE version = '1' AND success = 1", Integer.class)).isEqualTo(1);
        String body = http.getForObject("/api/health", String.class);
        assertThat(new com.fasterxml.jackson.databind.ObjectMapper().valueToTree(response.getBody()).size()).isEqualTo(3);
        assertSafe(body);
        assertThat(http.exchange("/api/health", HttpMethod.HEAD, null, String.class).getBody()).isNull();
    }

    @Test void mysqlCharsetCollationUtcDedicatedAccountAndInnoDb() {
        assertThat(jdbc.queryForObject("SELECT VERSION()", String.class).startsWith("8.4."))
                .as("integration database must be MySQL 8.4 LTS").isTrue();
        assertThat(jdbc.queryForObject("SELECT @@character_set_server", String.class)).isEqualTo("utf8mb4");
        assertThat(jdbc.queryForObject("SELECT @@collation_server", String.class)).isEqualTo("utf8mb4_0900_ai_ci");
        assertThat(jdbc.queryForObject("SELECT @@character_set_connection", String.class)).isEqualTo("utf8mb4");
        assertThat(jdbc.queryForObject("SELECT @@collation_connection", String.class)).isEqualTo("utf8mb4_0900_ai_ci");
        assertThat(jdbc.queryForObject("SELECT @@session.time_zone", String.class)).isIn("+00:00", "UTC");
        String currentUser = jdbc.queryForObject("SELECT CURRENT_USER()", String.class);
        assertThat(currentUser != null && !currentUser.split("@")[0].equalsIgnoreCase("root"))
                .as("connection must use a dedicated application account").isTrue();
        assertThat(jdbc.queryForObject("SELECT @@default_storage_engine", String.class)).isEqualToIgnoringCase("InnoDB");
        assertThat(jdbc.queryForObject("SELECT SUPPORT FROM information_schema.ENGINES WHERE ENGINE = 'InnoDB'", String.class))
                .isIn("YES", "DEFAULT");
        assertThat(jdbc.queryForObject("SELECT DEFAULT_CHARACTER_SET_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()", String.class))
                .isEqualTo("utf8mb4");
        assertThat(jdbc.queryForObject("SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = DATABASE()", String.class))
                .isEqualTo("utf8mb4_0900_ai_ci");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT IN ('flyway_schema_history','demo_account','auth_token','auth_login_limit','auth_audit','episode','episode_source_version','source_block','domain_audit','episode_assignment','translation_version','translation_block','review_decision','publication','review_block_comment','source_page_image','translation_page_image','work','work_genre','work_cover','work_episode','episode_view_count','episode_view_daily','work_recommend','account_profile','account_library','account_recent')", Integer.class))
                .as("only approved domain tables exist").isZero();
        HikariDataSource pool = (HikariDataSource) source;
        assertThat(pool.getConnectionTimeout()).isEqualTo(2000);
        assertThat(pool.getDataSourceProperties().getProperty("connectTimeout")).isEqualTo("2000");
        assertThat(pool.getDataSourceProperties().getProperty("socketTimeout")).isEqualTo("3000");
        assertThat(jdbc.getQueryTimeout()).isEqualTo(2);
    }

    @Test void realConnectionFailureIsBoundedAnd503() {
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:mysql://127.0.0.1:1/unavailable");
        config.setUsername("unavailable_user");
        config.setPassword("local_test_only");
        config.setConnectionTimeout(2000);
        config.setInitializationFailTimeout(-1);
        config.addDataSourceProperty("connectTimeout", "2000");
        config.addDataSourceProperty("socketTimeout", "3000");
        config.addDataSourceProperty("sslMode", "DISABLED");
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

    @Test void dockerProbeRunsSelectAndRejectsWrongPasswordWithoutLeakingIt() throws Exception {
        // This exercises the actual configured probe without changing accounts or container settings.
        // A failed one-off exec is NOT evidence that Docker's state became unhealthy.
        DockerResult id = docker("compose", "ps", "-q", "mysql");
        assertThat(id.exitCode()).isZero();
        assertThat(!id.output().isBlank()).as("a running local MySQL container is required").isTrue();
        DockerResult configuration = docker("inspect", "--format", "{{json .Config.Healthcheck.Test}}", id.output().trim());
        assertThat(configuration.exitCode()).isZero();
        String probe = new com.fasterxml.jackson.databind.ObjectMapper().readTree(configuration.output()).get(1).asText();
        assertThat(probe.contains("SELECT 1") && probe.contains("--protocol=TCP") && probe.contains("${MYSQL_PASSWORD}"))
                .as("healthcheck must use the application account and environment password").isTrue();
        String password = System.getenv("DB_PASSWORD");
        assertThat(password == null || !probe.contains(password)).as("inspect command must not contain a literal password").isTrue();
        DockerResult valid = dockerWithInput(probe + "\n", "compose", "exec", "-T", "mysql", "sh", "-s");
        assertThat(valid.exitCode()).isZero();
        DockerResult invalid = dockerWithInput("MYSQL_PASSWORD=\"invalid-${MYSQL_PASSWORD}\"; " + probe + "\n",
                "compose", "exec", "-T", "mysql", "sh", "-s");
        assertThat(invalid.exitCode()).isNotZero();
        assertThat(valid.output().isBlank() && invalid.output().isBlank()).as("healthcheck output must be suppressed").isTrue();
        DockerResult health = docker("inspect", "--format", "{{.State.Health.Status}}", id.output().trim());
        assertThat(health.exitCode()).isZero();
        assertThat(health.output().trim()).isEqualTo("healthy");
    }

    private DockerResult docker(String... arguments) throws Exception {
        return dockerWithInput(null, arguments);
    }

    private DockerResult dockerWithInput(String input, String... arguments) throws Exception {
        java.util.List<String> command = new java.util.ArrayList<>();
        command.add("docker");
        command.addAll(java.util.List.of(arguments));
        Process process = new ProcessBuilder(command).directory(Path.of("..").toFile()).redirectErrorStream(true).start();
        // Send shell scripts on stdin; Windows native argument quoting can alter sh -c scripts.
        try (var stdin = process.getOutputStream()) {
            if (input != null) stdin.write(input.getBytes(StandardCharsets.UTF_8));
        }
        if (!process.waitFor(15, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IllegalStateException("Docker verification timed out");
        }
        return new DockerResult(process.exitValue(), new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8));
    }

    private record DockerResult(int exitCode, String output) { }

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
