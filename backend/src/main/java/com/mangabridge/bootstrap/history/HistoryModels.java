package com.mangabridge.bootstrap.history;

import java.math.BigInteger;
import java.time.Instant;
import java.util.List;

public final class HistoryModels {
    private HistoryModels() { }
    public record Account(String id,String displayName) { }
    public record Item(String id,Instant occurredAt,String event,Account actor,String episodeId,String episodeTitle,
                       Integer sourceVersion,Integer translationVersionNo,Account subject) { }
    public record History(List<Item> items,long total) { }
    public record Filter(Long episodeId,String event,int limit,BigInteger offset) { }
}
