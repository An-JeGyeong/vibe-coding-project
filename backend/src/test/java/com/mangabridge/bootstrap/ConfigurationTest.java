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
                .withPropertyValues("DB_URL=jdbc:postgresql://localhost:1/test", "DB_USERNAME=test", "DB_PASSWORD=test")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    HikariDataSource source = context.getBean(HikariDataSource.class);
                    assertThat(source.getConnectionTimeout()).isEqualTo(2000);
                    assertThat(source.getValidationTimeout()).isEqualTo(1000);
                    assertThat(source.getDataSourceProperties().getProperty("connectTimeout")).isEqualTo("2");
                    assertThat(source.getDataSourceProperties().getProperty("socketTimeout")).isEqualTo("2");
                    assertThat(context.getBean(JdbcTemplate.class).getQueryTimeout()).isEqualTo(2);
                    ServerProperties server = Binder.get(context.getEnvironment()).bind("server", ServerProperties.class).get();
                    assertThat(server.getError().getIncludeMessage().name()).isEqualTo("NEVER");
                    assertThat(server.getError().getIncludeStacktrace().name()).isEqualTo("NEVER");
                    assertThat(server.getError().getIncludeBindingErrors().name()).isEqualTo("NEVER");
                    assertThat(server.getError().isIncludeException()).isFalse();
                });
    }

    private MockEnvironment validEnvironment() {
        return new MockEnvironment().withProperty("DB_URL", "private-value")
                .withProperty("DB_USERNAME", "private-value").withProperty("DB_PASSWORD", "private-value")
                .withProperty("CORS_ALLOWED_ORIGINS", "http://localhost:3000");
    }
}
