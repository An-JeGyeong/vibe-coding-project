package com.mangabridge.bootstrap.page;

import java.time.Instant;
import java.util.List;

public final class PageModels {
    private PageModels() { }
    public record Metadata(int pageNo,String contentType,int byteSize,Instant updatedAt) { }
    public record Pages(List<Metadata> items) { }
    public record Image(String contentType,byte[] bytes) {
        @Override public String toString() { return "Image[redacted]"; }
    }
    public record Saved(int status,Metadata metadata) { }
}
