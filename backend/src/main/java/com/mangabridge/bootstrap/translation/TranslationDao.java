package com.mangabridge.bootstrap.translation;

import static com.mangabridge.bootstrap.translation.TranslationModels.*;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class TranslationDao {
    private final JdbcTemplate jdbc;
    private static final org.springframework.jdbc.core.RowMapper<Stored> VERSION_ROW=(rs,n)->new Stored(
            rs.getLong(1),rs.getInt(2),rs.getString(3),rs.getInt(4),rs.getInt(5),rs.getTimestamp(6).toInstant(),
            rs.getTimestamp(7)==null?null:rs.getTimestamp(7).toInstant());
    public TranslationDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public List<Stored> versions(long episode) {
        return jdbc.query("SELECT id,version_no,status,source_version_no,draft_revision,created_at,submitted_at FROM translation_version WHERE episode_id=? ORDER BY version_no DESC",
                VERSION_ROW,episode);
    }
    public Stored version(long episode,int version) {
        var rows=jdbc.query("SELECT id,version_no,status,source_version_no,draft_revision,created_at,submitted_at FROM translation_version WHERE episode_id=? AND version_no=?",
                VERSION_ROW,episode,version);
        return rows.isEmpty()?null:rows.get(0);
    }
    public int latestTranslationVersion(long episode) {
        return jdbc.queryForObject("SELECT latest_translation_version FROM episode WHERE id=?",Integer.class,episode);
    }
    public long create(long episode,int version,int source,long actor,Instant now) {
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at) VALUES (?,?,?,'DRAFT',?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1,episode); statement.setInt(2,version); statement.setInt(3,source);
            statement.setLong(4,actor); statement.setTimestamp(5,Timestamp.from(now)); return statement;
        },key);
        jdbc.update("UPDATE episode SET latest_translation_version=? WHERE id=?",version,episode);
        return key.getKey().longValue();
    }
    public List<Block> blocks(long episode,Stored version) {
        return jdbc.query("SELECT s.seq,s.page_no,s.body,t.body FROM source_block s LEFT JOIN translation_block t ON t.translation_version_id=? AND t.source_seq=s.seq WHERE s.episode_id=? AND s.version_no=? ORDER BY s.seq",
                (rs,n)->new Block(rs.getInt(1),rs.getObject(2,Integer.class),rs.getString(3),rs.getString(4)),version.id(),episode,version.sourceVersion());
    }
    public Map<Integer,String> texts(long versionId) {
        var result=new TreeMap<Integer,String>();
        jdbc.query("SELECT source_seq,body FROM translation_block WHERE translation_version_id=? ORDER BY source_seq",
                (org.springframework.jdbc.core.RowCallbackHandler)rs->result.put(rs.getInt(1),rs.getString(2)),versionId);
        return result;
    }
    public void copy(long episode,int source,long previous,long created) {
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) SELECT ?,?,?,t.source_seq,t.body FROM translation_block t JOIN source_block s ON s.episode_id=? AND s.version_no=? AND s.seq=t.source_seq WHERE t.translation_version_id=?",
                created,episode,source,episode,source,previous);
    }
    public void replace(long episode,Stored version,Map<Integer,String> texts) {
        jdbc.update("DELETE FROM translation_block WHERE translation_version_id=?",version.id());
        if(!texts.isEmpty()) jdbc.batchUpdate("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,?,?,?)",
                texts.entrySet(),texts.size(),(statement,entry)->{
                    statement.setLong(1,version.id()); statement.setLong(2,episode); statement.setInt(3,version.sourceVersion());
                    statement.setInt(4,entry.getKey()); statement.setString(5,entry.getValue());
                });
        jdbc.update("UPDATE translation_version SET draft_revision=? WHERE id=?",Math.addExact(version.revision(),1),version.id());
    }
    public void submit(long id,Instant now) {
        jdbc.update("UPDATE translation_version SET status='REVIEW_PENDING',submitted_at=? WHERE id=?",Timestamp.from(now),id);
    }
    public void audit(long actor,String event,long episode,int source,long translation,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version,translation_version_id) VALUES (?,?,?,?,?,?)",
                Timestamp.from(now),actor,event,episode,source,translation);
    }
    /** Called only while the source-save transaction holds the episode row lock. */
    public void invalidateOnSourceSave(long episode,int newSource,long actor,Instant now) {
        var approved=jdbc.queryForList("SELECT id FROM translation_version WHERE episode_id=? AND status='APPROVED'",Long.class,episode);
        jdbc.update("UPDATE translation_version SET status='INVALIDATED' WHERE episode_id=? AND status IN ('DRAFT','REVIEW_PENDING','APPROVED')",episode);
        for(long id:approved) {
            int updated=jdbc.update("UPDATE review_decision SET invalidated_at=? WHERE translation_version_id=? AND decision='APPROVED'",Timestamp.from(now),id);
            if(updated!=1) throw new DataIntegrityViolationException("Approval invalidation failed");
            audit(actor,"APPROVAL_INVALIDATED",episode,newSource,id,now);
        }
    }
}
