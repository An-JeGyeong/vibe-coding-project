package com.mangabridge.bootstrap.config;

import java.util.Arrays;
import java.util.List;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;

public class RequiredEnvironment implements ApplicationContextInitializer<ConfigurableApplicationContext> {
    @Override
    public void initialize(ConfigurableApplicationContext context) {
        validate(context.getEnvironment());
    }

    public static void validate(Environment environment) {
        for (String name : List.of("DB_URL", "DB_USERNAME", "DB_PASSWORD", "CORS_ALLOWED_ORIGINS")) {
            String value = environment.getProperty(name);
            if (value == null || value.isBlank()) {
                fail("Missing required environment variable: " + name);
            }
        }
        origins(environment.getProperty("CORS_ALLOWED_ORIGINS"));
    }

    public static List<String> origins(String value) {
        if (value == null || value.isBlank() || value.contains("*")) {
            fail("Invalid environment variable: CORS_ALLOWED_ORIGINS (empty or wildcard)");
        }
        List<String> origins = Arrays.stream(value.split(",", -1)).map(String::trim).toList();
        if (origins.stream().anyMatch(String::isEmpty)) {
            fail("Invalid environment variable: CORS_ALLOWED_ORIGINS (empty origin)");
        }
        return origins;
    }

    private static void fail(String message) {
        System.err.println(message);
        throw new IllegalStateException(message);
    }
}
