package com.mangabridge.bootstrap.episode;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

public final class EpisodeModels {
    private EpisodeModels() { }
    public record CreateRequest(JsonNode title) {
        @Override public String toString() { return "CreateRequest[redacted]"; }
    }
    public record BlockRequest(JsonNode pageNo, JsonNode text) {
        @Override public String toString() { return "BlockRequest[redacted]"; }
    }
    public record SourceRequest(JsonNode expectedVersion, List<BlockRequest> blocks) {
        @Override public String toString() { return "SourceRequest[redacted]"; }
    }
    public record Created(String id, String title, int latestSourceVersion, Instant createdAt) { }
    public record Item(String id, String title, int latestSourceVersion, Instant updatedAt) { }
    public record Episodes(List<Item> items, long total) { }
    public record SavedBy(String id, String displayName) { }
    public record Block(int seq, Integer pageNo, String text) { }
    public record Source(int version, Instant savedAt, SavedBy savedBy, List<Block> blocks) { }
    public record Version(int version, Instant savedAt, SavedBy savedBy, int blockCount) { }
    public record Versions(List<Version> items) { }
    public record Detail(String id, String title, int latestSourceVersion, Instant createdAt,
                         Instant updatedAt, Source source) { }
    public record Stored(long id, String title, int latest, Instant createdAt, Instant updatedAt) { }
}
