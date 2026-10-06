package com.mangabridge.bootstrap.translation;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;

public final class TranslationModels {
    private TranslationModels() { }
    public record BlockRequest(JsonNode seq,JsonNode text) {
        @Override public String toString() { return "BlockRequest[redacted]"; }
    }
    public record SaveRequest(JsonNode expectedRevision,List<BlockRequest> blocks) {
        @Override public String toString() { return "SaveRequest[redacted]"; }
    }
    public record SubmitRequest(JsonNode expectedRevision) { }
    public record Item(int versionNo,String status,int sourceVersion,int revision,Instant createdAt,Instant submittedAt) { }
    public record Versions(int latestSourceVersion,List<Item> items) { }
    public record Created(int versionNo,String status,int sourceVersion,int revision) { }
    public record Block(int seq,Integer pageNo,String source,String text) {
        @Override public String toString() { return "Block[redacted]"; }
    }
    public record Detail(int versionNo,String status,int sourceVersion,int revision,Instant createdAt,
                         Instant submittedAt,boolean editable,List<Block> blocks) { }
    public record Saved(int revision,boolean changed) { }
    public record Submitted(int versionNo,String status,Instant submittedAt) { }
    public record Stored(long id,int versionNo,String status,int sourceVersion,int revision,Instant createdAt,Instant submittedAt) {
        Item item() { return new Item(versionNo,status,sourceVersion,revision,createdAt,submittedAt); }
    }
}
