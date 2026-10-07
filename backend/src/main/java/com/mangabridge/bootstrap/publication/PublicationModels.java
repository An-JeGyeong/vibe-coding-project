package com.mangabridge.bootstrap.publication;

import java.time.Instant;
import java.util.List;

public final class PublicationModels {
    private PublicationModels() { }
    public record Published(int versionNo,String status,Instant publishedAt) { }
    public record Held(int versionNo,String status,Instant heldAt) { }
    public record PublicationPointer(long id,int versionNo,int sourceVersion,String status) { }
    public record Entry(int versionNo,int sourceVersion,Instant publishedAt) { }
    public record Publication(Entry current,Entry held,List<Entry> history) { }
    public record Item(String episodeId,String title,Instant publishedAt) { }
    public record Episodes(List<Item> items,long total) { }
    public record Block(int seq,Integer pageNo,String text) { }
    public record Detail(String episodeId,String title,Instant publishedAt,List<Block> blocks) { }
}
