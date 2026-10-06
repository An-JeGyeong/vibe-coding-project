package com.mangabridge.bootstrap.review;

import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.translation.TranslationModels.Block;
import java.time.Instant;
import java.util.List;

public final class ReviewModels {
    private ReviewModels() { }
    public record Decision(String decision,Instant decidedAt,String reason) {
        @Override public String toString() { return "Decision[redacted]"; }
    }
    public record RejectRequest(JsonNode reason) {
        @Override public String toString() { return "RejectRequest[redacted]"; }
    }
    public record Pending(String episodeId,String title,int versionNo,int sourceVersion,Instant submittedAt) { }
    public record Queue(List<Pending> items,long total) { }
    public record Item(int versionNo,String status,int sourceVersion,Instant submittedAt,Decision decision) { }
    public record Versions(int latestSourceVersion,List<Item> items) { }
    public record Detail(int versionNo,String status,int sourceVersion,Instant submittedAt,boolean decidable,Decision decision,List<Block> blocks) { }
    public record OperatorDetail(int versionNo,String status,int sourceVersion,Instant createdAt,Instant submittedAt,
                                 Decision decision,Instant invalidatedAt,List<Block> blocks) { }
    public record Result(int versionNo,String status,Instant decidedAt) { }
}
