package com.mangabridge.bootstrap.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

/** The personal data of a signed-in account: library, recent episodes, recommendations (CONTRACTS 32.4). */
@Service
public class MeService {
    private static final Pattern ID = Pattern.compile("^[1-9][0-9]{0,17}$");

    /** The key an account's recommendation is stored under: derived from its id, so a vote follows the account to any device. */
    public static String voterKey(long accountId) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(("acct:" + accountId).getBytes(StandardCharsets.UTF_8));
            var hex = new StringBuilder();
            for (byte b : digest) hex.append(String.format("%02x", b));
            return hex.substring(0, 32);
        } catch (java.security.NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private final MeDao dao;
    private final Clock clock;
    private final ObjectMapper mapper;
    private final TransactionTemplate tx;

    MeService(MeDao dao, Clock clock, ObjectMapper mapper, PlatformTransactionManager manager) {
        this.dao = dao; this.clock = clock; this.mapper = StrictJson.of(mapper);
        this.tx = new TransactionTemplate(manager);
    }

    private <T> T run(java.util.function.Supplier<T> work) {
        try { return tx.execute(status -> work.get()); }
        catch (DataAccessException | TransactionException failure) { throw AccountFailure.unavailable(); }
    }
    private static long id(String value) {
        if (value == null || !ID.matcher(value).matches()) throw AccountFailure.missing();
        return Long.parseLong(value);
    }
    private static long validId(String value) {
        if (value == null || !ID.matcher(value).matches()) throw AccountFailure.invalid();
        return Long.parseLong(value);
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }

    // ---- library ----
    Map<String, Object> library(long account) {
        return run(() -> libraryBody(account));
    }
    private Map<String, Object> libraryBody(long account) {
        var items = new ArrayList<Map<String, Object>>();
        for (var row : dao.library(account)) items.add(entry("workId", Long.toString(row.workId()), "addedAt", row.addedAt().toString()));
        return Map.of("items", items);
    }
    void addToLibrary(long account, String work) {
        long workId = id(work);
        run(() -> {
            if (!dao.publicWork(workId)) throw AccountFailure.missing();
            dao.addWork(account, workId, now());
            dao.trimLibrary(account);
            return null;
        });
    }
    void removeFromLibrary(long account, String work) {
        long workId = work != null && ID.matcher(work).matches() ? Long.parseLong(work) : -1;
        if (workId < 0) throw AccountFailure.missing();
        run(() -> { dao.removeWork(account, workId); return null; });
    }

    public record LibraryMerge(List<String> workIds) { }
    Map<String, Object> mergeLibrary(long account, String raw) {
        LibraryMerge request = parse(raw, LibraryMerge.class);
        if (request == null || request.workIds() == null || request.workIds().size() > MeDao.LIBRARY_MAX) throw AccountFailure.invalid();
        var wanted = new ArrayList<Long>();
        for (String value : request.workIds()) wanted.add(validId(value));
        return run(() -> {
            // new works go behind the existing ones, in the order the browser had them (newest first)
            Instant oldest = dao.oldestLibrary(account);
            Instant base = oldest == null ? now() : oldest;
            Set<Long> seen = new java.util.HashSet<>();
            int placed = 0;
            for (long workId : wanted) {
                if (!seen.add(workId) || dao.inLibrary(account, workId) || !dao.publicWork(workId)) continue;
                placed++;
                dao.addWork(account, workId, base.minusMillis(placed));
            }
            dao.trimLibrary(account);
            return libraryBody(account);
        });
    }

    // ---- recent episodes ----
    Map<String, Object> recent(long account) {
        return run(() -> recentBody(account));
    }
    private Map<String, Object> recentBody(long account) {
        var items = new ArrayList<Map<String, Object>>();
        for (var row : dao.recent(account)) items.add(entry("episodeId", Long.toString(row.episodeId()), "readAt", row.readAt().toString()));
        return Map.of("items", items);
    }
    void touchRecent(long account, String episode) {
        long episodeId = id(episode);
        run(() -> {
            if (!dao.publicEpisode(episodeId)) throw AccountFailure.missing();
            dao.touchEpisode(account, episodeId, now(), false);
            dao.trimRecent(account);
            return null;
        });
    }
    void clearRecent(long account) {
        run(() -> { dao.clearRecent(account); return null; });
    }

    public record RecentItem(String episodeId, String readAt) { }
    public record RecentMerge(List<RecentItem> items) { }
    Map<String, Object> mergeRecent(long account, String raw) {
        RecentMerge request = parse(raw, RecentMerge.class);
        if (request == null || request.items() == null || request.items().size() > MeDao.RECENT_MAX) throw AccountFailure.invalid();
        record Parsed(long episodeId, Instant at) { }
        var parsed = new ArrayList<Parsed>();
        Instant ceiling = now();
        for (RecentItem item : request.items()) {
            if (item == null || item.readAt() == null) throw AccountFailure.invalid();
            Instant at;
            try { at = Instant.parse(item.readAt()); } catch (Exception malformed) { throw AccountFailure.invalid(); }
            parsed.add(new Parsed(validId(item.episodeId()), at.isAfter(ceiling) ? ceiling : at.truncatedTo(ChronoUnit.MICROS)));
        }
        return run(() -> {
            for (var item : parsed) if (dao.publicEpisode(item.episodeId())) dao.touchEpisode(account, item.episodeId(), item.at(), true);
            dao.trimRecent(account);
            return recentBody(account);
        });
    }

    // ---- recommendations ----
    Map<String, Object> recommendations(long account) {
        return run(() -> {
            var ids = new ArrayList<String>();
            for (long workId : dao.recommended(voterKey(account))) ids.add(Long.toString(workId));
            return Map.of("workIds", ids);
        });
    }

    private <T> T parse(String raw, Class<T> type) {
        try { return raw == null ? null : mapper.readValue(raw, type); }
        catch (Exception malformed) { throw AccountFailure.invalid(); }
    }
    private static Map<String, Object> entry(String k1, Object v1, String k2, Object v2) {
        var map = new LinkedHashMap<String, Object>();
        map.put(k1, v1); map.put(k2, v2);
        return map;
    }
}
