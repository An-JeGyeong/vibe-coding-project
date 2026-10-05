package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.config.RequiredEnvironment;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.jdbc.DataSourceAutoConfiguration;
import org.springframework.boot.autoconfigure.jdbc.JdbcTemplateAutoConfiguration;
import org.springframework.boot.autoconfigure.web.ServerProperties;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.FileSystemResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.*;

class ConfigurationTest {
    @Test void everyMissingVariableFailsWithoutPrintingValues() {
        for (String missing : new String[]{"DB_URL", "DB_USERNAME", "DB_PASSWORD", "CORS_ALLOWED_ORIGINS"}) {
            MockEnvironment environment = validEnvironment();
            environment.setProperty(missing, " ");
            assertThatThrownBy(() -> RequiredEnvironment.validate(environment))
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining(missing)
                    .hasMessageNotContaining("private-value");
        }
    }

    @Test void corsEmptyAndWildcardFailContextStartup() {
        for (String origin : new String[]{"", " ", "*", "https://*.example", "http://localhost:3000,"}) {
            new ApplicationContextRunner().withInitializer(context ->
                    RequiredEnvironment.validate(validEnvironment().withProperty("CORS_ALLOWED_ORIGINS", origin)))
                    .run(context -> assertThat(context).hasFailed());
        }
        RequiredEnvironment.validate(validEnvironment());
    }

    @Test void actualYamlBindsTimeoutsAndErrorProperties() throws Exception {
        var yaml = new YamlPropertySourceLoader().load("application", new ClassPathResource("application.yml")).get(0);
        new ApplicationContextRunner()
                .withInitializer(context -> context.getEnvironment().getPropertySources().addLast(yaml))
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class, JdbcTemplateAutoConfiguration.class))
                .withPropertyValues("DB_URL=jdbc:mysql://localhost:1/test", "DB_USERNAME=test", "DB_PASSWORD=test")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    HikariDataSource source = context.getBean(HikariDataSource.class);
                    assertThat(source.getConnectionTimeout()).isEqualTo(2000);
                    assertThat(source.getValidationTimeout()).isEqualTo(1000);
                    assertThat(source.getDataSourceProperties().getProperty("connectTimeout")).isEqualTo("2000");
                    assertThat(source.getDataSourceProperties().getProperty("socketTimeout")).isEqualTo("3000");
                    assertThat(source.getDataSourceProperties().getProperty("characterEncoding")).isEqualTo("UTF-8");
                    assertThat(source.getDataSourceProperties().getProperty("connectionCollation")).isEqualTo("utf8mb4_0900_ai_ci");
                    assertThat(source.getDataSourceProperties().getProperty("connectionTimeZone")).isEqualTo("UTC");
                    assertThat(source.getDataSourceProperties().getProperty("forceConnectionTimeZoneToSession")).isEqualTo("true");
                    assertThat(source.getDataSourceProperties().getProperty("sslMode")).isEqualTo("VERIFY_IDENTITY");
                    assertThat(source.getDataSourceProperties()).doesNotContainKey("allowPublicKeyRetrieval");
                    assertThat(context.getBean(JdbcTemplate.class).getQueryTimeout()).isEqualTo(2);
                    ServerProperties server = Binder.get(context.getEnvironment()).bind("server", ServerProperties.class).get();
                    assertThat(server.getError().getIncludeMessage().name()).isEqualTo("NEVER");
                    assertThat(server.getError().getIncludeStacktrace().name()).isEqualTo("NEVER");
                    assertThat(server.getError().getIncludeBindingErrors().name()).isEqualTo("NEVER");
                    assertThat(server.getError().isIncludeException()).isFalse();
                });
    }

    @Test void rootApplicationAccountFailsBeforeDatabaseConnection() {
        assertThatThrownBy(() -> RequiredEnvironment.validate(validEnvironment().withProperty("DB_USERNAME", "root")))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("DB_USERNAME")
                .hasMessageNotContaining("private-value");
    }

    @Test void localAndProductionTlsAreSeparated() throws Exception {
        var loader = new YamlPropertySourceLoader();
        for (String profile : new String[]{"local", "prod"}) {
            var environment = new MockEnvironment();
            environment.getPropertySources().addLast(loader.load("profile", new ClassPathResource("application-" + profile + ".yml")).get(0));
            environment.getPropertySources().addLast(loader.load("common", new ClassPathResource("application.yml")).get(0));
            String prefix = "spring.datasource.hikari.data-source-properties.";
            assertThat(environment.getProperty(prefix + "sslMode")).isEqualTo(profile.equals("local") ? "DISABLED" : "VERIFY_IDENTITY");
            assertThat(environment.getProperty(prefix + "allowPublicKeyRetrieval")).isEqualTo(profile.equals("local") ? "true" : null);
        }
    }

    @Test void composeUsesAnApplicationSelectWithoutPasswordArguments() throws Exception {
        var compose = new YamlPropertySourceLoader().load("compose", new FileSystemResource("../docker-compose.yml")).get(0);
        assertThat(compose.getProperty("services.mysql.image")).isEqualTo("mysql:8.4.11");
        assertThat(compose.getProperty("services.mysql.environment.MYSQL_RANDOM_ROOT_PASSWORD")).isEqualTo("yes");
        assertThat(compose.getProperty("services.mysql.ports[0]")).isEqualTo("127.0.0.1:3306:3306");
        String probe = (String) compose.getProperty("services.mysql.healthcheck.test[1]");
        assertThat(probe).contains("MYSQL_PWD=\"$${MYSQL_PASSWORD}\"", "--protocol=TCP", "--user=\"$${MYSQL_USER}\"",
                "--database=\"$${MYSQL_DATABASE}\"", "SELECT 1", ">/dev/null 2>&1")
                .doesNotContain("--password", "mysqladmin", "mangabridge_local_only", "root");
    }

    private MockEnvironment validEnvironment() {
        return new MockEnvironment().withProperty("DB_URL", "private-value")
                .withProperty("DB_USERNAME", "private-value").withProperty("DB_PASSWORD", "private-value")
                .withProperty("CORS_ALLOWED_ORIGINS", "http://localhost:3000");
    }
}
