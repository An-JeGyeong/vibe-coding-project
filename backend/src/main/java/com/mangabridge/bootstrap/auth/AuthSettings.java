package com.mangabridge.bootstrap.auth;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

@Configuration
public class AuthSettings {
    @Bean Clock authClock() { return Clock.systemUTC(); }
    @Bean PasswordEncoder authPasswordEncoder() { return new BCryptPasswordEncoder(12); }
    @Bean long authTokenTtl(Environment env) {
        long ttl;
        try { ttl = Long.parseLong(env.getProperty("AUTH_TOKEN_TTL_SECONDS", "3600")); }
        catch (NumberFormatException e) { throw invalid("Invalid AUTH_TOKEN_TTL_SECONDS (seconds, 1..86400)"); }
        if (ttl < 1 || ttl > 86400) throw invalid("Invalid AUTH_TOKEN_TTL_SECONDS (seconds, 1..86400)");
        if (!java.util.Arrays.asList(env.getActiveProfiles()).contains("local") ||
                !env.getProperty("AUTH_CLIENT_IP_MODE", "DIRECT").equals("DIRECT"))
            throw invalid("DemoAuth requires approved client IP policy; local DIRECT only currently approved");
        return ttl;
    }
    private IllegalStateException invalid(String message) {
        System.err.println(message);
        return new IllegalStateException(message);
    }
}
