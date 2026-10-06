package com.mangabridge.bootstrap.auth;

public class AuthFailure extends RuntimeException {
    public final int status;
    public final String code;
    private AuthFailure(int status, String code) {
        super(code); this.status = status; this.code = code;
    }
    static AuthFailure invalid() { return new AuthFailure(400, "INVALID_REQUEST"); }
    static AuthFailure credentials() { return new AuthFailure(401, "INVALID_CREDENTIALS"); }
    static AuthFailure required() { return new AuthFailure(401, "AUTH_REQUIRED"); }
    static AuthFailure forbidden() { return new AuthFailure(403, "FORBIDDEN"); }
    static AuthFailure unavailable() { return new AuthFailure(503, "AUTH_UNAVAILABLE"); }
}
