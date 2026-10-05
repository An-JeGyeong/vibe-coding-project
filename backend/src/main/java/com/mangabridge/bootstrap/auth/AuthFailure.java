package com.mangabridge.bootstrap.auth;

public class AuthFailure extends RuntimeException {
    public final int status;
    public final String code;
    public final long retryAfter;
    private AuthFailure(int status, String code, long retryAfter) {
        super(code); this.status = status; this.code = code; this.retryAfter = retryAfter;
    }
    static AuthFailure invalid() { return new AuthFailure(400, "INVALID_REQUEST", 0); }
    static AuthFailure credentials() { return new AuthFailure(401, "INVALID_CREDENTIALS", 0); }
    static AuthFailure required() { return new AuthFailure(401, "AUTH_REQUIRED", 0); }
    static AuthFailure forbidden() { return new AuthFailure(403, "FORBIDDEN", 0); }
    static AuthFailure unavailable() { return new AuthFailure(503, "AUTH_UNAVAILABLE", 0); }
    static AuthFailure limited(long seconds) { return new AuthFailure(429, "LOGIN_RATE_LIMITED", seconds); }
}
