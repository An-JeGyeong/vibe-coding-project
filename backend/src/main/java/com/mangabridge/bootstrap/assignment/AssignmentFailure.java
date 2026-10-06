package com.mangabridge.bootstrap.assignment;

public final class AssignmentFailure extends RuntimeException {
    public final int status;
    public final String code;
    private AssignmentFailure(int status, String code) { super(code); this.status=status; this.code=code; }
    static AssignmentFailure invalid() { return new AssignmentFailure(400,"INVALID_REQUEST"); }
    static AssignmentFailure notFound() { return new AssignmentFailure(404,"NOT_FOUND"); }
    static AssignmentFailure unavailable() { return new AssignmentFailure(503,"SERVICE_UNAVAILABLE"); }
}
