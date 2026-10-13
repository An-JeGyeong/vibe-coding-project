package com.mangabridge.bootstrap.account;

import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
class AccountDao {
    record Row(long id, String loginId, String displayName, String role, String passwordHash) {
        @Override public String toString() { return "Row[redacted]"; }
    }
    private final JdbcTemplate jdbc;
    AccountDao(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    /** A reader account; a duplicate login id surfaces as a DuplicateKeyException. */
    long insertReader(String loginId, String displayName, String hash) {
        var keys = new GeneratedKeyHolder();
        jdbc.update(connection -> {
            var statement = connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,'READER',?)", Statement.RETURN_GENERATED_KEYS);
            statement.setString(1, loginId); statement.setString(2, displayName); statement.setString(3, hash);
            return statement;
        }, keys);
        return keys.getKey().longValue();
    }
    void insertProfile(long id, Instant now) {
        jdbc.update("INSERT INTO account_profile(account_id,bio,updated_at) VALUES (?,'',?)", id, Timestamp.from(now));
    }
    Row row(long id) {
        var rows = jdbc.query("SELECT id,login_id,display_name,role,password_hash FROM demo_account WHERE id=? AND enabled=1",
                (rs, n) -> new Row(rs.getLong(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5)), id);
        return rows.isEmpty() ? null : rows.get(0);
    }
    String bio(long id) {
        var rows = jdbc.query("SELECT bio FROM account_profile WHERE account_id=?", (rs, n) -> rs.getString(1), id);
        return rows.isEmpty() ? "" : rows.get(0);
    }
    void updateName(long id, String name) {
        jdbc.update("UPDATE demo_account SET display_name=? WHERE id=?", name, id);
    }
    void saveBio(long id, String bio, Instant now) {
        jdbc.update("INSERT INTO account_profile(account_id,bio,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE bio=VALUES(bio),updated_at=VALUES(updated_at)", id, bio, Timestamp.from(now));
    }
    void updatePassword(long id, String hash) {
        jdbc.update("UPDATE demo_account SET password_hash=? WHERE id=?", hash, id);
    }
}
