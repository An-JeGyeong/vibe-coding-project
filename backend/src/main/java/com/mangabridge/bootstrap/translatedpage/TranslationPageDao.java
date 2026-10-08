package com.mangabridge.bootstrap.translatedpage;

import com.mangabridge.bootstrap.page.PageModels.*;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class TranslationPageDao {
    private final JdbcTemplate jdbc;
    public TranslationPageDao(JdbcTemplate jdbc) {this.jdbc=jdbc;}
    public boolean sourceHasPage(long episode,int source,int page) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM source_block WHERE episode_id=? AND version_no=? AND page_no=?",Long.class,episode,source,page)>0;
    }
    public boolean exists(long version,int page) {return jdbc.queryForObject("SELECT COUNT(*) FROM translation_page_image WHERE translation_version_id=? AND page_no=?",Long.class,version,page)>0;}
    public List<Metadata> list(long version) {
        return jdbc.query("SELECT page_no,content_type,byte_size,updated_at FROM translation_page_image WHERE translation_version_id=? ORDER BY page_no",(rs,n)->new Metadata(rs.getInt(1),rs.getString(2),rs.getInt(3),rs.getTimestamp(4).toInstant()),version);
    }
    public Image image(long version,int page) {
        var rows=jdbc.query("SELECT content_type,image_data FROM translation_page_image WHERE translation_version_id=? AND page_no=?",(rs,n)->new Image(rs.getString(1),rs.getBytes(2)),version,page);
        return rows.isEmpty()?null:rows.get(0);
    }
    public List<Integer> publicPages(long version) {return jdbc.queryForList("SELECT page_no FROM translation_page_image WHERE translation_version_id=? ORDER BY page_no",Integer.class,version);}
    public Long publicVersion(long episode) {
        var rows=jdbc.queryForList("SELECT t.id FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' WHERE e.id=?",Long.class,episode);
        return rows.isEmpty()?null:rows.get(0);
    }
    public void save(long version,int page,String type,byte[] bytes,long actor,Instant now) {
        jdbc.update("INSERT INTO translation_page_image(translation_version_id,page_no,content_type,byte_size,image_data,uploaded_by,updated_at) VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),byte_size=VALUES(byte_size),image_data=VALUES(image_data),uploaded_by=VALUES(uploaded_by),updated_at=VALUES(updated_at)",version,page,type,bytes.length,bytes,actor,Timestamp.from(now));
    }
    public void audit(long actor,long episode,int source,long version,Instant now) {
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version,translation_version_id) VALUES (?,?,'TRANSLATION_PAGE_IMAGE_SAVED',?,?,?)",Timestamp.from(now),actor,episode,source,version);
    }
}
