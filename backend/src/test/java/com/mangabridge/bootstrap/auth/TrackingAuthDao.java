package com.mangabridge.bootstrap.auth;

import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;

// Capture exact generated audit IDs, including anonymous failures, without deleting user rows.
public class TrackingAuthDao extends AuthDao {
    private final JdbcTemplate jdbc;
    private final Set<Long> auditIds=ConcurrentHashMap.newKeySet();
    public TrackingAuthDao(JdbcTemplate jdbc) { super(jdbc); this.jdbc=jdbc; }
    @Override void audit(Long actor,String event,String reason,Instant now) {
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO auth_audit(occurred_at,account_id,event,reason) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setTimestamp(1,Timestamp.from(now)); statement.setObject(2,actor,java.sql.Types.BIGINT);
            statement.setString(3,event); statement.setString(4,reason); return statement;
        },key);
        auditIds.add(key.getKey().longValue());
    }
    public void cleanupAudits() {
        for(Long auditId:auditIds) jdbc.update("DELETE FROM auth_audit WHERE id=?",auditId);
        auditIds.clear();
    }
}
