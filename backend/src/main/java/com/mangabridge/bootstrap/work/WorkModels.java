package com.mangabridge.bootstrap.work;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
public final class WorkModels {
 private WorkModels() { }
 public record Create(JsonNode title,JsonNode author,JsonNode description,JsonNode readingDirection,JsonNode genres) {
  @Override public String toString(){return "Create[redacted]";}
 }
 public record Update(JsonNode expectedRevision,JsonNode title,JsonNode author,JsonNode description,JsonNode readingDirection,JsonNode genres,JsonNode isPublic,JsonNode isFeatured,JsonNode isBanner) {
  @Override public String toString(){return "Update[redacted]";}
 }
 public record Link(JsonNode workId,JsonNode episodeNo) { }
 public record CoverMetadata(String contentType,int byteSize,Instant updatedAt) { }
 public record CoverSaved(int status,CoverMetadata metadata) { }
 public record Values(String title,String author,String description,String direction,List<String> genres,boolean isPublic,boolean featured,boolean banner) { }
 public record Row(long id,String title,String author,String description,String direction,boolean isPublic,boolean featured,boolean banner,int revision,Instant updatedAt) {
  @Override public String toString(){return "Row[redacted]";}
 }
}
