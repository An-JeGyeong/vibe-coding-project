package com.mangabridge.bootstrap.account;

/** A failure of the account endpoints (CONTRACTS 32): a fixed status and code, never a reason that names a field or a value. */
public class AccountFailure extends RuntimeException {
    public final int status;
    public final String code;
    public final Long retryAfterSeconds;
    private AccountFailure(int status, String code, Long retryAfterSeconds) {
        super(code); this.status = status; this.code = code; this.retryAfterSeconds = retryAfterSeconds;
    }
    static AccountFailure invalid() { return new AccountFailure(400, "INVALID_REQUEST", null); }
    static AccountFailure wrongCurrentPassword() { return new AccountFailure(400, "INVALID_CURRENT_PASSWORD", null); }
    static AccountFailure missing() { return new AccountFailure(404, "NOT_FOUND", null); }
    static AccountFailure taken() { return new AccountFailure(409, "LOGIN_ID_TAKEN", null); }
    static AccountFailure rateLimited(long retryAfterSeconds) { return new AccountFailure(429, "REGISTER_RATE_LIMITED", Math.max(1, retryAfterSeconds)); }
    static AccountFailure unavailable() { return new AccountFailure(503, "SERVICE_UNAVAILABLE", null); }
}
