package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.health.HealthController;
import com.mangabridge.bootstrap.health.HealthService;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.ServerSocket;
import java.time.Duration;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class NetworkTimeoutTest {
    @Test void actualUnresponsiveSocketReturns503InFiniteTime() throws Exception {
        // A real TCP socket accepts connections but never speaks MySQL.
        // This is a network failure test, NOT evidence of a successful MySQL connection.
        try (ServerSocket stalledServer = new ServerSocket(0)) {
            HikariConfig config = new HikariConfig();
            config.setJdbcUrl("jdbc:mysql://127.0.0.1:" + stalledServer.getLocalPort() + "/unavailable");
            config.setUsername("local_test_user");
            config.setPassword("local_test_only");
            config.setConnectionTimeout(2000);
            config.setInitializationFailTimeout(-1);
            config.setMaximumPoolSize(1);
            config.addDataSourceProperty("connectTimeout", "2000");
            config.addDataSourceProperty("socketTimeout", "3000");
            config.addDataSourceProperty("sslMode", "DISABLED");
            try (HikariDataSource source = new HikariDataSource(config)) {
                JdbcTemplate template = new JdbcTemplate(source);
                template.setQueryTimeout(2);
                var mvc = MockMvcBuilders.standaloneSetup(new HealthController(new HealthService(template))).build();
                assertTimeoutPreemptively(Duration.ofSeconds(15), () -> {
                    String body = mvc.perform(get("/api/health")).andExpect(status().isServiceUnavailable())
                            .andExpect(jsonPath("$.db").value("DOWN")).andExpect(jsonPath("$.status").value("UP"))
                            .andReturn().getResponse().getContentAsString();
                    assertThat(body).doesNotContain("jdbc:", "127.0.0.1", "local_test_user", "Exception");
                });
            }
        }
    }
}
