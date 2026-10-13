package com.mangabridge.bootstrap.account;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/** The library and the recently read episodes of one account (CONTRACTS 32.4). Every statement is scoped by account_id. */
@Repository
class MeDao {
    static final int LIBRARY_MAX = 200, RECENT_MAX = 20;
    record LibraryRow(long workId, Instant addedAt) { }
    record RecentRow(long episodeId, Instant readAt) { }
    private static final String PUBLIC_EPISODE = "FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED'";

    private final JdbcTemplate jdbc;
    MeDao(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    boolean publicWork(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM work w WHERE w.id=? AND w.is_public=1 AND EXISTS(SELECT 1 FROM work_episode we JOIN episode e ON e.id=we.episode_id JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' WHERE we.work_id=w.id)", Integer.class, id) > 0;
    }
    boolean publicEpisode(long id) {
        return jdbc.queryForObject("SELECT COUNT(*) " + PUBLIC_EPISODE + " WHERE e.id=?", Integer.class, id) > 0;
    }

    List<LibraryRow> library(long account) {
        return jdbc.query("SELECT work_id,added_at FROM account_library WHERE account_id=? ORDER BY added_at DESC,work_id DESC LIMIT " + LIBRARY_MAX,
                (rs, n) -> new LibraryRow(rs.getLong(1), rs.getTimestamp(2).toInstant()), account);
    }
    /** Adds a work; one that is already there keeps its place. */
    void addWork(long account, long work, Instant at) {
        jdbc.update("INSERT INTO account_library(account_id,work_id,added_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE added_at=added_at", account, work, Timestamp.from(at));
    }
    void removeWork(long account, long work) {
        jdbc.update("DELETE FROM account_library WHERE account_id=? AND work_id=?", account, work);
    }
    Instant oldestLibrary(long account) {
        Timestamp oldest = jdbc.queryForObject("SELECT MIN(added_at) FROM account_library WHERE account_id=?", Timestamp.class, account);
        return oldest == null ? null : oldest.toInstant();
    }
    boolean inLibrary(long account, long work) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM account_library WHERE account_id=? AND work_id=?", Integer.class, account, work) > 0;
    }
    void trimLibrary(long account) {
        jdbc.update("DELETE FROM account_library WHERE account_id=? AND work_id NOT IN (SELECT work_id FROM (SELECT work_id FROM account_library WHERE account_id=? ORDER BY added_at DESC,work_id DESC LIMIT " + LIBRARY_MAX + ") kept)", account, account);
    }

    List<RecentRow> recent(long account) {
        return jdbc.query("SELECT episode_id,read_at FROM account_recent WHERE account_id=? ORDER BY read_at DESC,episode_id DESC LIMIT " + RECENT_MAX,
                (rs, n) -> new RecentRow(rs.getLong(1), rs.getTimestamp(2).toInstant()), account);
    }
    /** Sets the time an episode was read; with {@code keepLater} an existing later time is kept (a merge never makes it older). */
    void touchEpisode(long account, long episode, Instant at, boolean keepLater) {
        jdbc.update("INSERT INTO account_recent(account_id,episode_id,read_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE read_at=" + (keepLater ? "GREATEST(read_at,VALUES(read_at))" : "VALUES(read_at)"),
                account, episode, Timestamp.from(at));
    }
    void clearRecent(long account) {
        jdbc.update("DELETE FROM account_recent WHERE account_id=?", account);
    }
    void trimRecent(long account) {
        jdbc.update("DELETE FROM account_recent WHERE account_id=? AND episode_id NOT IN (SELECT episode_id FROM (SELECT episode_id FROM account_recent WHERE account_id=? ORDER BY read_at DESC,episode_id DESC LIMIT " + RECENT_MAX + ") kept)", account, account);
    }

    /** The public works this account recommended, newest first. */
    List<Long> recommended(String key) {
        return jdbc.query("SELECT r.work_id FROM work_recommend r JOIN work w ON w.id=r.work_id AND w.is_public=1 WHERE r.voter_key=? AND EXISTS(SELECT 1 FROM work_episode we JOIN episode e ON e.id=we.episode_id JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' WHERE we.work_id=w.id) ORDER BY r.created_at DESC,r.work_id DESC LIMIT " + LIBRARY_MAX,
                (rs, n) -> rs.getLong(1), key);
    }
}
