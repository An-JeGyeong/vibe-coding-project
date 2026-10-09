package com.mangabridge.bootstrap.auth;

import java.time.Instant;

public final class AuthModels {
    private AuthModels() { }
    public enum Role { OPERATOR, TRANSLATOR, REVIEWER, READER, TYPESETTER }
    public record User(String id, String displayName, Role role) { }
    public record CurrentUser(User user, Instant expiresAt) { }
    public record LoginRequest(String loginId, String password) {
        @Override public String toString() { return "LoginRequest[redacted]"; }
    }
    public record LoginResponse(User user, String accessToken, String tokenType, Instant expiresAt) {
        @Override public String toString() { return "LoginResponse[redacted]"; }
    }
    public record Account(long id, String displayName, Role role, String passwordHash, boolean enabled) {
        User user() { return new User(Long.toString(id), displayName, role); }
        @Override public String toString() { return "Account[redacted]"; }
    }
    public record ErrorDetail(String code, String message) { }
    public record ErrorResponse(ErrorDetail error) { }
}
