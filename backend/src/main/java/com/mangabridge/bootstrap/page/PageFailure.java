package com.mangabridge.bootstrap.page;

public final class PageFailure extends RuntimeException {
    public final int status;
    public final String code;
    private PageFailure(int status,String code) { super(code);this.status=status;this.code=code; }
    public static PageFailure invalid() { return new PageFailure(400,"INVALID_REQUEST"); }
    public static PageFailure notFound() { return new PageFailure(404,"NOT_FOUND"); }
    public static PageFailure unavailable() { return new PageFailure(503,"SERVICE_UNAVAILABLE"); }
}
