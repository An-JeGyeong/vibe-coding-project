package com.mangabridge.bootstrap.history;

public class HistoryFailure extends RuntimeException {
    public final int status;
    public final String code;
    private HistoryFailure(int status,String code) { super(code);this.status=status;this.code=code; }
    public static HistoryFailure invalid() { return new HistoryFailure(400,"INVALID_REQUEST"); }
    public static HistoryFailure unavailable() { return new HistoryFailure(503,"SERVICE_UNAVAILABLE"); }
}
