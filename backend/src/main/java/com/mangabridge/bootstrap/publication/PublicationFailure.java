package com.mangabridge.bootstrap.publication;

public class PublicationFailure extends RuntimeException {
    public final int status;
    public final String code,currentStatus;
    private PublicationFailure(int status,String code,String currentStatus) {
        super(code);this.status=status;this.code=code;this.currentStatus=currentStatus;
    }
    static PublicationFailure invalid() { return new PublicationFailure(400,"INVALID_REQUEST",null); }
    static PublicationFailure notFound() { return new PublicationFailure(404,"NOT_FOUND",null); }
    static PublicationFailure state(String status) { return new PublicationFailure(409,"STATE_CONFLICT",status); }
    static PublicationFailure unavailable() { return new PublicationFailure(503,"SERVICE_UNAVAILABLE",null); }
}
