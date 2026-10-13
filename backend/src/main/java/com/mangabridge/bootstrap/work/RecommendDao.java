package com.mangabridge.bootstrap.work;
import java.sql.Timestamp;
import java.time.Instant;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository
public class RecommendDao {
 private final JdbcTemplate jdbc;
 public RecommendDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public boolean publishedWork(long id){return jdbc.queryForObject("SELECT COUNT(*) FROM work w WHERE w.id=? AND w.is_public=1 AND EXISTS(SELECT 1 FROM work_episode we JOIN episode e ON e.id=we.episode_id JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' WHERE we.work_id=w.id)",Integer.class,id)>0;}
 public void recommend(long id,String key,Instant now){jdbc.update("INSERT INTO work_recommend(work_id,voter_key,created_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE voter_key=VALUES(voter_key)",id,key,Timestamp.from(now));}
 public void unrecommend(long id,String key){jdbc.update("DELETE FROM work_recommend WHERE work_id=? AND voter_key=?",id,key);}
 public long count(long id){return jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=?",Long.class,id);}
}
