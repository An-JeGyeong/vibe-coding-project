package com.mangabridge.bootstrap.translation;

import java.util.List;
import java.util.Map;

public final class TranslationFailure extends RuntimeException {
    public final int status;
    public final String code;
    public final Map<String,Object> details;
    private TranslationFailure(int status,String code,Map<String,Object> details) {
        super(code); this.status=status; this.code=code; this.details=details;
    }
    static TranslationFailure invalid() { return new TranslationFailure(400,"INVALID_REQUEST",Map.of()); }
    static TranslationFailure notFound() { return new TranslationFailure(404,"NOT_FOUND",Map.of()); }
    static TranslationFailure unavailable() { return new TranslationFailure(503,"SERVICE_UNAVAILABLE",Map.of()); }
    static TranslationFailure state(String current) { return new TranslationFailure(409,"STATE_CONFLICT",current==null?Map.of():Map.of("currentStatus",current)); }
    static TranslationFailure revision(int latest) { return new TranslationFailure(409,"VERSION_CONFLICT",Map.of("latestRevision",latest)); }
    static TranslationFailure incomplete(List<Integer> missing) { return new TranslationFailure(400,"INCOMPLETE_TRANSLATION",Map.of("missingSeqs",missing)); }
}
