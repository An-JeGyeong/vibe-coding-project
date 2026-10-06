package com.mangabridge.bootstrap.review;

public class ReviewFailure extends RuntimeException {
    public final int status;
    public final String code,currentStatus;
    private ReviewFailure(int status,String code,String currentStatus) {
        super(code); this.status=status; this.code=code; this.currentStatus=currentStatus;
    }
    public static ReviewFailure invalid() { return new ReviewFailure(400,"INVALID_REQUEST",null); }
    public static ReviewFailure notFound() { return new ReviewFailure(404,"NOT_FOUND",null); }
    public static ReviewFailure state(String status) { return new ReviewFailure(409,"STATE_CONFLICT",status); }
    public static ReviewFailure unavailable() { return new ReviewFailure(503,"SERVICE_UNAVAILABLE",null); }
    public static ReviewFailure forbidden() { return new ReviewFailure(403,"FORBIDDEN",null); }
}
