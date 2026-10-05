package com.mangabridge.bootstrap;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mangabridge.bootstrap.config.CorsConfig;
import com.mangabridge.bootstrap.health.HealthController;
import com.mangabridge.bootstrap.health.HealthService;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class HealthContractTest {
    private JdbcTemplate jdbc;
    private MockMvc mvc;

    @BeforeEach void setup() {
        jdbc = mock(JdbcTemplate.class);
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1);
        mvc = MockMvcBuilders.standaloneSetup(new HealthController(new HealthService(jdbc)))
                .addFilters(new CorsConfig().corsFilter("http://localhost:3000")).build();
    }

    @Test void exactBodyTimestampAndNoCache() throws Exception {
        MvcResult result = mvc.perform(get("/api/health"))
                .andExpect(status().isOk()).andExpect(content().contentType("application/json"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn();
        JsonNode json = new ObjectMapper().readTree(result.getResponse().getContentAsString());
        assertThat(json.size()).isEqualTo(3);
        assertThat(json.get("status").asText()).isEqualTo("UP");
        assertThat(json.get("db").asText()).isEqualTo("UP");
        assertThat(json.get("time").asText()).endsWith("Z");
        Instant.parse(json.get("time").asText());
        assertSafe(result.getResponse().getContentAsString());
    }

    @Test void failureIs503AndEveryCallChecksDatabase() throws Exception {
        when(jdbc.queryForObject("SELECT 1", Integer.class)).thenReturn(1)
                .thenThrow(new DataAccessResourceFailureException("jdbc:mysql://private-db:3306 secret_user Exception"))
                .thenReturn(1);
        mvc.perform(get("/api/health")).andExpect(status().isOk());
        String body = mvc.perform(get("/api/health")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.status").value("UP")).andExpect(jsonPath("$.db").value("DOWN"))
                .andExpect(header().string("Cache-Control", "no-store")).andReturn().getResponse().getContentAsString();
        assertSafe(body);
        mvc.perform(get("/api/health")).andExpect(status().isOk());
        verify(jdbc, times(3)).queryForObject("SELECT 1", Integer.class);
    }

    @Test void corsOriginAndPreflight() throws Exception {
        mvc.perform(get("/api/health").header("Origin", "http://localhost:3000"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", "http://localhost:3000"))
                .andExpect(header().doesNotExist("Access-Control-Allow-Credentials"));
        mvc.perform(get("/api/health").header("Origin", "https://unapproved.example"))
                .andExpect(status().isForbidden()).andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
        mvc.perform(options("/api/health").header("Origin", "http://localhost:3000")
                .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "Content-Type"))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Headers", "Content-Type"));
        mvc.perform(options("/api/health").header("Origin", "https://unapproved.example")
                .header("Access-Control-Request-Method", "GET")).andExpect(status().isForbidden());
        mvc.perform(options("/api/health").header("Origin", "http://localhost:3000")
                .header("Access-Control-Request-Method", "GET").header("Access-Control-Request-Headers", "Authorization"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/health")).andExpect(status().isOk())
                .andExpect(header().doesNotExist("Access-Control-Allow-Origin"));
    }

    @Test void changingMethodsAre405AndUnapprovedOriginsAre403() throws Exception {
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE")) {
            mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method), "/api/health"))
                    .andExpect(status().isMethodNotAllowed());
            mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method), "/api/health")
                    .header("Origin", "http://localhost:3000")).andExpect(status().isMethodNotAllowed());
            mvc.perform(request(org.springframework.http.HttpMethod.valueOf(method), "/api/health")
                    .header("Origin", "https://unapproved.example")).andExpect(status().isForbidden());
        }
    }

    private void assertSafe(String body) {
        assertThat(body).doesNotContain("jdbc:", "private-db", "secret_user", "Exception", "Spring", "Java", "Next.js", "3.5.16");
    }
}
