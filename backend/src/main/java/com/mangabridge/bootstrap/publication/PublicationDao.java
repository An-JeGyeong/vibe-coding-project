package com.mangabridge.bootstrap.publication;

import static com.mangabridge.bootstrap.publication.PublicationModels.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class PublicationDao {
    private final JdbcTemplate jdbc;
    // Publication permits history rows; resolve the latest publication for the exact pointer.
    private static final String PUBLIC=" FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' JOIN publication p ON p.id=(SELECT p2.id FROM publication p2 WHERE p2.episode_id=e.id AND p2.translation_version_id=t.id ORDER BY p2.published_at DESC,p2.id DESC LIMIT 1)";
    public PublicationDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public boolean validApproval(long version,int source) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM review_decision WHERE translation_version_id=? AND decision='APPROVED' AND invalidated_at IS NULL AND source_version_no=?",Integer.class,version,source)==1;
    }
    public void publish(long episode,long version,int source,long actor,Instant now) {
        jdbc.update("UPDATE translation_version SET status='PUBLISHED' WHERE id=?",version);
        jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,?,?,?)",episode,version,source,actor,Timestamp.from(now));
        jdbc.update("UPDATE episode SET published_translation_version_id=? WHERE id=?",version,episode);
    }
    public void audit(long actor,long episode,int source,long version,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version,translation_version_id) VALUES (?,?,'TRANSLATION_PUBLISHED',?,?,?)",Timestamp.from(now),actor,episode,source,version);
    }
    public PublicationPointer pointer(long episode) {
        var rows=jdbc.query("SELECT t.id,t.version_no,t.source_version_no,t.status FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id WHERE e.id=?",
                (rs,n)->new PublicationPointer(rs.getLong(1),rs.getInt(2),rs.getInt(3),rs.getString(4)),episode);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void hold(long version) {
        jdbc.update("UPDATE translation_version SET status='ON_HOLD' WHERE id=?",version);
    }
    public void resume(long episode,long version,int source,long actor,Instant now) {
        jdbc.update("UPDATE translation_version SET status='PUBLISHED' WHERE id=?",version);
        jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,?,?,?)",episode,version,source,actor,Timestamp.from(now));
    }
    public void lifecycleAudit(long actor,String event,long episode,int source,long version,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version,translation_version_id) VALUES (?,?,?,?,?,?)",Timestamp.from(now),actor,event,episode,source,version);
    }
    public Publication publication(long episode) {
        var history=jdbc.query("SELECT t.version_no,p.source_version_no,p.published_at FROM publication p JOIN translation_version t ON t.id=p.translation_version_id AND t.episode_id=p.episode_id WHERE p.episode_id=? ORDER BY p.published_at DESC,p.id DESC",
                (rs,n)->new Entry(rs.getInt(1),rs.getInt(2),rs.getTimestamp(3).toInstant()),episode);
        var current=jdbc.query("SELECT t.version_no,p.source_version_no,p.published_at"+PUBLIC+" WHERE e.id=?",
                (rs,n)->new Entry(rs.getInt(1),rs.getInt(2),rs.getTimestamp(3).toInstant()),episode);
        var held=jdbc.query("SELECT t.version_no,p.source_version_no,p.published_at FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='ON_HOLD' JOIN publication p ON p.id=(SELECT p2.id FROM publication p2 WHERE p2.episode_id=e.id AND p2.translation_version_id=t.id ORDER BY p2.published_at DESC,p2.id DESC LIMIT 1) WHERE e.id=?",
                (rs,n)->new Entry(rs.getInt(1),rs.getInt(2),rs.getTimestamp(3).toInstant()),episode);
        return new Publication(current.isEmpty()?null:current.get(0),held.isEmpty()?null:held.get(0),history);
    }
    public long count() { return jdbc.queryForObject("SELECT COUNT(*)"+PUBLIC,Long.class); }
    public List<Item> episodes(int limit,long offset) {
        return jdbc.query("SELECT e.id,e.title,p.published_at"+PUBLIC+" ORDER BY e.id ASC LIMIT ? OFFSET ?",
                (rs,n)->new Item(Long.toString(rs.getLong(1)),rs.getString(2),rs.getTimestamp(3).toInstant()),limit,offset);
    }
    public Detail detail(long episode) {
        var rows=jdbc.query("SELECT e.id,e.title,p.published_at,t.id,t.source_version_no"+PUBLIC+" WHERE e.id=?",
                (rs,n)->new Pointer(Long.toString(rs.getLong(1)),rs.getString(2),rs.getTimestamp(3).toInstant(),rs.getLong(4),rs.getInt(5)),episode);
        if(rows.isEmpty()) return null;
        var row=rows.get(0);
        var blocks=jdbc.query("SELECT b.source_seq,s.page_no,b.body FROM translation_block b JOIN source_block s ON s.episode_id=b.episode_id AND s.version_no=b.source_version_no AND s.seq=b.source_seq WHERE b.translation_version_id=? AND b.episode_id=? AND b.source_version_no=? ORDER BY b.source_seq ASC",
                (rs,n)->new Block(rs.getInt(1),rs.getObject(2,Integer.class),rs.getString(3)),row.version(),episode,row.source());
        return new Detail(row.episodeId(),row.title(),row.publishedAt(),blocks);
    }
    private record Pointer(String episodeId,String title,Instant publishedAt,long version,int source) { }
}
