package com.mangabridge.bootstrap.auth;

import static com.mangabridge.bootstrap.auth.AuthModels.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AuthDao {
    private final JdbcTemplate jdbc;
    public AuthDao(JdbcTemplate jdbc) { this.jdbc = jdbc; }
    Account account(String loginId) {
        var rows = jdbc.query("SELECT id,display_name,role,password_hash,enabled FROM demo_account WHERE login_id=?",
                (rs, n) -> new Account(rs.getLong(1), rs.getString(2), Role.valueOf(rs.getString(3)), rs.getString(4), rs.getBoolean(5)), loginId);
        return rows.isEmpty() ? null : rows.get(0);
    }
    void insertAccount(String id, String name, Role role, String hash) {
        jdbc.update("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)", id,name,role.name(),hash);
    }
    void issue(byte[] hash, long id, Instant expires) {
        jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",hash,id,ts(expires));
    }
    CurrentUser current(byte[] hash, Instant now) {
        List<CurrentUser> rows = jdbc.query("SELECT a.id,a.display_name,a.role,t.expires_at FROM auth_token t JOIN demo_account a ON a.id=t.account_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at>? AND a.enabled=TRUE",
                (rs,n)->new CurrentUser(new User(Long.toString(rs.getLong(1)),rs.getString(2),Role.valueOf(rs.getString(3))),rs.getTimestamp(4).toInstant()),hash,ts(now));
        return rows.isEmpty()?null:rows.get(0);
    }
    Long revoke(byte[] hash, Instant now) {
        var rows = jdbc.query("SELECT account_id FROM auth_token WHERE token_hash=? AND revoked_at IS NULL AND expires_at>? FOR UPDATE",
                (rs,n)->rs.getLong(1),hash,ts(now));
        if(rows.isEmpty()) return null;
        jdbc.update("UPDATE auth_token SET revoked_at=? WHERE token_hash=?",ts(now),hash);
        return rows.get(0);
    }
    /** Revokes every live token of the account except the one given (a password change, CONTRACTS 32.3). */
    void revokeOthers(long accountId, byte[] keep, Instant now) {
        jdbc.update("UPDATE auth_token SET revoked_at=? WHERE account_id=? AND revoked_at IS NULL AND expires_at>? AND token_hash<>?",ts(now),accountId,ts(now),keep);
    }
    void audit(Long id, String event, String reason, Instant now) {
        jdbc.update("INSERT INTO auth_audit(occurred_at,account_id,event,reason) VALUES (?,?,?,?)",ts(now),id,event,reason);
    }
    void cleanup(Instant now) {
        jdbc.update("DELETE FROM auth_token WHERE expires_at<? OR revoked_at<?",ts(now.minusSeconds(86400)),ts(now.minusSeconds(86400)));
        jdbc.update("DELETE FROM auth_login_limit WHERE updated_at<? AND (blocked_until IS NULL OR blocked_until<=?)",ts(now.minusSeconds(86400)),ts(now));
        jdbc.update("DELETE FROM auth_audit WHERE occurred_at<?",ts(now.minusSeconds(604800)));
    }
    private static Timestamp ts(Instant i) { return Timestamp.from(i); }
}
