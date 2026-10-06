package com.mangabridge.bootstrap.assignment;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.List;
import com.mangabridge.bootstrap.episode.EpisodeModels.Block;

public final class AssignmentModels {
    private AssignmentModels() { }
    public record SetRequest(JsonNode accountId) {
        @Override public String toString() { return "SetRequest[redacted]"; }
    }
    public record Candidate(String id, String displayName, String role) { }
    public record Candidates(List<Candidate> items) { }
    public record Account(String id, String displayName) { }
    public record Slot(Account account, Instant assignedAt) { }
    public record Assignments(Slot translator, Slot reviewer) { }
    public record Result(String role, Account account, Instant assignedAt, boolean changed) { }
    public record SaveResult(int status, Result body) { }
    public record Item(String id, String title, String assignedRole, int latestSourceVersion,
                       Instant assignedAt, Instant updatedAt) { }
    public record Episodes(List<Item> items, long total) { }
    public record Source(int version, Instant savedAt, List<Block> blocks) { }
    public record Detail(String id, String title, String assignedRole, int latestSourceVersion, Source source) { }
}
