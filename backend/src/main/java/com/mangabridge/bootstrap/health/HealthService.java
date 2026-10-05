package com.mangabridge.bootstrap.health;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class HealthService {
    private static final Logger LOGGER = LoggerFactory.getLogger(HealthService.class);
    private final JdbcTemplate jdbc;

    public HealthService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public boolean databaseAvailable() {
        try {
            return Integer.valueOf(1).equals(jdbc.queryForObject("SELECT 1", Integer.class));
        } catch (DataAccessException failure) {
            LOGGER.warn("Database health check failed: connection/query unavailable or timed out.");
            return false;
        }
    }
}
