package com.mangabridge.bootstrap.work;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository
public class ViewDao {
 private final JdbcTemplate jdbc;public ViewDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public boolean published(long episode){return jdbc.queryForObject("SELECT COUNT(*) FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' WHERE e.id=?",Integer.class,episode)>0;}
 public void increment(long episode){jdbc.update("INSERT INTO episode_view_count(episode_id,view_count) VALUES (?,1) ON DUPLICATE KEY UPDATE view_count=view_count+1",episode);}
}
