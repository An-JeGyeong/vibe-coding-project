package com.mangabridge.bootstrap.review;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import static com.mangabridge.bootstrap.review.ReviewModels.*;

@Repository
public class ReviewDao {
    private final JdbcTemplate jdbc;
    private static final String PENDING=" FROM translation_version t JOIN episode e ON e.id=t.episode_id JOIN episode_assignment a ON a.episode_id=e.id AND a.assignee_role='REVIEWER' WHERE a.account_id=? AND t.status='REVIEW_PENDING'";
    public ReviewDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public long count(long account) { return jdbc.queryForObject("SELECT COUNT(*)"+PENDING,Long.class,account); }
    public List<Pending> pending(long account,int limit,long offset) {
        return jdbc.query("SELECT e.id,e.title,t.version_no,t.source_version_no,t.submitted_at"+PENDING+" ORDER BY t.submitted_at ASC,e.id ASC,t.version_no ASC LIMIT ? OFFSET ?",
                (rs,n)->new Pending(Long.toString(rs.getLong(1)),rs.getString(2),rs.getInt(3),rs.getInt(4),rs.getTimestamp(5).toInstant()),account,limit,offset);
    }
    public long author(long version) { return jdbc.queryForObject("SELECT created_by FROM translation_version WHERE id=?",Long.class,version); }
    public Decision decision(long version) {
        var rows=jdbc.query("SELECT decision,decided_at,reason FROM review_decision WHERE translation_version_id=?",
                (rs,n)->new Decision(rs.getString(1),rs.getTimestamp(2).toInstant(),rs.getString(3)),version);
        return rows.isEmpty()?null:rows.get(0);
    }
    public Instant invalidatedAt(long version) {
        var rows=jdbc.query("SELECT invalidated_at FROM review_decision WHERE translation_version_id=?",
                (rs,n)->rs.getTimestamp(1)==null?null:rs.getTimestamp(1).toInstant(),version);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void decide(long version,int source,long reviewer,String decision,String reason,Instant now) {
        jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reason,reviewer_id,source_version_no,decided_at) VALUES (?,?,?,?,?,?)",
                version,decision,reason,reviewer,source,Timestamp.from(now));
        jdbc.update("UPDATE translation_version SET status=? WHERE id=?",decision,version);
    }
    public long decisionId(long version) {
        return jdbc.queryForObject("SELECT id FROM review_decision WHERE translation_version_id=?",Long.class,version);
    }
    public CommentDecision commentDecision(long decision) {
        var rows=jdbc.query("SELECT translation_version_id,decision FROM review_decision WHERE id=?",
                (rs,n)->new CommentDecision(rs.getLong(1),rs.getString(2)),decision);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void insertComment(long decision,long version,CommentInput comment,Instant now) {
        jdbc.update("INSERT INTO review_block_comment(review_decision_id,translation_version_id,source_seq,body,created_at) VALUES (?,?,?,?,?)",
                decision,version,comment.seq(),comment.text(),Timestamp.from(now));
    }
    public void audit(long actor,String event,long episode,int source,long version,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version,translation_version_id) VALUES (?,?,?,?,?,?)",
                Timestamp.from(now),actor,event,episode,source,version);
    }
}
