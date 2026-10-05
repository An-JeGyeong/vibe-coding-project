package com.mangabridge.bootstrap.episode;

import static com.mangabridge.bootstrap.episode.EpisodeModels.*;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

@Repository
public class EpisodeDao {
    private final JdbcTemplate jdbc;
    public EpisodeDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public long insertEpisode(String title, long actor, Instant now) {
        var key=new GeneratedKeyHolder();
        jdbc.update(connection->{
            var statement=connection.prepareStatement("INSERT INTO episode(title,created_by,created_at,updated_at) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
            statement.setString(1,title); statement.setLong(2,actor);
            statement.setTimestamp(3,Timestamp.from(now)); statement.setTimestamp(4,Timestamp.from(now));
            return statement;
        },key);
        return key.getKey().longValue();
    }
    public Stored episode(long id, boolean lock) {
        var rows=jdbc.query("SELECT id,title,latest_source_version,created_at,updated_at FROM episode WHERE id=?"+(lock?" FOR UPDATE":""),
                (rs,n)->new Stored(rs.getLong(1),rs.getString(2),rs.getInt(3),rs.getTimestamp(4).toInstant(),rs.getTimestamp(5).toInstant()),id);
        return rows.isEmpty()?null:rows.get(0);
    }
    public long countEpisodes() { return jdbc.queryForObject("SELECT COUNT(*) FROM episode",Long.class); }
    public List<Item> episodes(int limit,long offset) {
        return jdbc.query("SELECT id,title,latest_source_version,updated_at FROM episode ORDER BY id DESC LIMIT ? OFFSET ?",
                (rs,n)->new Item(Long.toString(rs.getLong(1)),rs.getString(2),rs.getInt(3),rs.getTimestamp(4).toInstant()),limit,offset);
    }
    public List<Version> versions(long id) {
        return jdbc.query("SELECT v.version_no,v.created_at,a.id,a.display_name,v.block_count FROM episode_source_version v JOIN demo_account a ON a.id=v.created_by WHERE v.episode_id=? ORDER BY v.version_no DESC",
                (rs,n)->new Version(rs.getInt(1),rs.getTimestamp(2).toInstant(),new SavedBy(Long.toString(rs.getLong(3)),rs.getString(4)),rs.getInt(5)),id);
    }
    public Source source(long id,long version) {
        var rows=jdbc.query("SELECT v.version_no,v.created_at,a.id,a.display_name FROM episode_source_version v JOIN demo_account a ON a.id=v.created_by WHERE v.episode_id=? AND v.version_no=?",
                (rs,n)->new Source(rs.getInt(1),rs.getTimestamp(2).toInstant(),new SavedBy(Long.toString(rs.getLong(3)),rs.getString(4)),List.of()),id,version);
        if(rows.isEmpty()) return null;
        var source=rows.get(0);
        var blocks=jdbc.query("SELECT seq,page_no,body FROM source_block WHERE episode_id=? AND version_no=? ORDER BY seq",
                (rs,n)->new Block(rs.getInt(1),rs.getObject(2,Integer.class),rs.getString(3)),id,version);
        return new Source(source.version(),source.savedAt(),source.savedBy(),blocks);
    }
    public void insertSource(long id,int version,long actor,Instant now,List<Block> blocks) {
        jdbc.update("INSERT INTO episode_source_version(episode_id,version_no,created_by,created_at,block_count) VALUES (?,?,?,?,?)",id,version,actor,Timestamp.from(now),blocks.size());
        jdbc.batchUpdate("INSERT INTO source_block(episode_id,version_no,seq,page_no,body) VALUES (?,?,?,?,?)",
                blocks,blocks.size(),(statement,block)->{
                    statement.setLong(1,id); statement.setInt(2,version); statement.setInt(3,block.seq());
                    statement.setObject(4,block.pageNo(),java.sql.Types.INTEGER); statement.setString(5,block.text());
                });
        jdbc.update("UPDATE episode SET latest_source_version=?,updated_at=? WHERE id=?",version,Timestamp.from(now),id);
    }
    public void audit(long actor,String event,long episode,Integer version,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version) VALUES (?,?,?,?,?)",
                Timestamp.from(now),actor,event,episode,version);
    }
}
