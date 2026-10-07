package com.mangabridge.bootstrap.ai;

public final class AiFailure extends RuntimeException {
    public final int status;
    public final String code,currentStatus;
    private AiFailure(int status,String code,String currentStatus) { super(code);this.status=status;this.code=code;this.currentStatus=currentStatus; }
    public static AiFailure invalid() { return new AiFailure(400,"INVALID_REQUEST",null); }
    public static AiFailure notFound() { return new AiFailure(404,"NOT_FOUND",null); }
    public static AiFailure state(String status) { return new AiFailure(409,"STATE_CONFLICT",status); }
    public static AiFailure unavailable() { return new AiFailure(503,"AI_UNAVAILABLE",null); }
    public static AiFailure database() { return new AiFailure(503,"SERVICE_UNAVAILABLE",null); }
}
