package com.mangabridge.bootstrap.ai;

import java.util.List;

public final class AiModels {
    private AiModels() { }
    public record Source(int seq,String text) {
        @Override public String toString() { return "Source[redacted]"; }
    }
    public record Suggestion(int seq,String text) {
        @Override public String toString() { return "Suggestion[redacted]"; }
    }
    public record Result(int versionNo,String provider,List<Suggestion> suggestions) {
        @Override public String toString() { return "Result[redacted]"; }
    }
}
