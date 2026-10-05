package com.mangabridge.bootstrap.episode;

public final class EpisodeFailure extends RuntimeException {
    public final int status;
    public final String code;
    public final Integer latestVersion;
    private EpisodeFailure(int status, String code, Integer latestVersion) {
        super(code); this.status=status; this.code=code; this.latestVersion=latestVersion;
    }
    static EpisodeFailure invalid() { return new EpisodeFailure(400,"INVALID_REQUEST",null); }
    static EpisodeFailure notFound() { return new EpisodeFailure(404,"NOT_FOUND",null); }
    static EpisodeFailure conflict(int latest) { return new EpisodeFailure(409,"VERSION_CONFLICT",latest); }
    static EpisodeFailure unavailable() { return new EpisodeFailure(503,"SERVICE_UNAVAILABLE",null); }
}
