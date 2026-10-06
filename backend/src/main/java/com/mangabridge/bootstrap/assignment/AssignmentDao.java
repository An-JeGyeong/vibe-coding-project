package com.mangabridge.bootstrap.assignment;

import static com.mangabridge.bootstrap.assignment.AssignmentModels.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class AssignmentDao {
    private final JdbcTemplate jdbc;
    public AssignmentDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public List<Candidate> candidates(String role) {
        return jdbc.query("SELECT id,display_name,role FROM demo_account WHERE role=? AND enabled=1 ORDER BY id",
                (rs,n)->new Candidate(Long.toString(rs.getLong(1)),rs.getString(2),rs.getString(3)),role);
    }
    public Candidate eligibleAccount(long id,String role) {
        var rows=jdbc.query("SELECT id,display_name,role FROM demo_account WHERE id=? AND role=? AND enabled=1",
                (rs,n)->new Candidate(Long.toString(rs.getLong(1)),rs.getString(2),rs.getString(3)),id,role);
        return rows.isEmpty()?null:rows.get(0);
    }
    public Slot slot(long episode,String role) {
        var rows=jdbc.query("SELECT a.id,a.display_name,x.assigned_at FROM episode_assignment x JOIN demo_account a ON a.id=x.account_id WHERE x.episode_id=? AND x.assignee_role=?",
                (rs,n)->new Slot(new Account(Long.toString(rs.getLong(1)),rs.getString(2)),rs.getTimestamp(3).toInstant()),episode,role);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void upsert(long episode,String role,long account,long actor,Instant now) {
        jdbc.update("INSERT INTO episode_assignment(episode_id,assignee_role,account_id,assigned_by,assigned_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE account_id=?,assigned_by=?,assigned_at=?",
                episode,role,account,actor,Timestamp.from(now),account,actor,Timestamp.from(now));
    }
    public void audit(long actor,long episode,long subject,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,subject_account_id) VALUES (?,?,'ASSIGNED',?,?)",
                Timestamp.from(now),actor,episode,subject);
    }
    public long countMine(long account,String role) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM episode_assignment WHERE account_id=? AND assignee_role=?",Long.class,account,role);
    }
    public List<Item> mine(long account,String role,int limit,long offset) {
        return jdbc.query("SELECT e.id,e.title,x.assignee_role,e.latest_source_version,x.assigned_at,e.updated_at FROM episode_assignment x JOIN episode e ON e.id=x.episode_id WHERE x.account_id=? AND x.assignee_role=? ORDER BY e.id DESC LIMIT ? OFFSET ?",
                (rs,n)->new Item(Long.toString(rs.getLong(1)),rs.getString(2),rs.getString(3),rs.getInt(4),rs.getTimestamp(5).toInstant(),rs.getTimestamp(6).toInstant()),account,role,limit,offset);
    }
    public boolean assigned(long episode,long account,String role) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM episode_assignment WHERE episode_id=? AND account_id=? AND assignee_role=?",Integer.class,episode,account,role)==1;
    }
}
