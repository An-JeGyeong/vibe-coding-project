package com.mangabridge.bootstrap.translatedpage;

public final class TranslationPageFailure extends RuntimeException {
    public final int status;
    public final String code,currentStatus;
    private TranslationPageFailure(int status,String code,String currentStatus) {super(code);this.status=status;this.code=code;this.currentStatus=currentStatus;}
    public static TranslationPageFailure forbidden() {return new TranslationPageFailure(403,"FORBIDDEN",null);}
    public static TranslationPageFailure invalid() {return new TranslationPageFailure(400,"INVALID_REQUEST",null);}
    public static TranslationPageFailure notFound() {return new TranslationPageFailure(404,"NOT_FOUND",null);}
    public static TranslationPageFailure unavailable() {return new TranslationPageFailure(503,"SERVICE_UNAVAILABLE",null);}
    public static TranslationPageFailure state(String status) {return new TranslationPageFailure(409,"STATE_CONFLICT",status);}
}
