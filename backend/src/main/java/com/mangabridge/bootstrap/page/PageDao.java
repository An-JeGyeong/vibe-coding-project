package com.mangabridge.bootstrap.page;

import static com.mangabridge.bootstrap.page.PageModels.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class PageDao {
    private final JdbcTemplate jdbc;
    public PageDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    public boolean sourceHasPage(long episode,int version,int page) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM source_block WHERE episode_id=? AND version_no=? AND page_no=?",Long.class,episode,version,page)>0;
    }
    public boolean exists(long episode,int page) { return jdbc.queryForObject("SELECT COUNT(*) FROM source_page_image WHERE episode_id=? AND page_no=?",Long.class,episode,page)>0; }
    public List<Metadata> list(long episode) {
        return jdbc.query("SELECT page_no,content_type,byte_size,updated_at FROM source_page_image WHERE episode_id=? ORDER BY page_no",
                (rs,n)->new Metadata(rs.getInt(1),rs.getString(2),rs.getInt(3),rs.getTimestamp(4).toInstant()),episode);
    }
    public Image image(long episode,int page) {
        var rows=jdbc.query("SELECT content_type,image_data FROM source_page_image WHERE episode_id=? AND page_no=?",
                (rs,n)->new Image(rs.getString(1),rs.getBytes(2)),episode,page);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void save(long episode,int page,String type,byte[] bytes,long actor,Instant now) {
        jdbc.update("INSERT INTO source_page_image(episode_id,page_no,content_type,byte_size,image_data,uploaded_by,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),byte_size=VALUES(byte_size),image_data=VALUES(image_data),uploaded_by=VALUES(uploaded_by),updated_at=VALUES(updated_at)",episode,page,type,bytes.length,bytes,actor,Timestamp.from(now));
    }
    public void audit(long actor,long episode,int source,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version) VALUES (?,?,'PAGE_IMAGE_SAVED',?,?)",Timestamp.from(now),actor,episode,source);
    }
}
