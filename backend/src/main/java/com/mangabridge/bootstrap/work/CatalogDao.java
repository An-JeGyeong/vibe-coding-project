package com.mangabridge.bootstrap.work;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository
public class CatalogDao {
 private final JdbcTemplate jdbc;public CatalogDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 private static final String PUBLIC=" FROM episode e JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' JOIN publication p ON p.id=(SELECT p2.id FROM publication p2 WHERE p2.episode_id=e.id AND p2.translation_version_id=t.id ORDER BY p2.published_at DESC,p2.id DESC LIMIT 1) ";
 public record Summary(long id,String title,String author,boolean banner,boolean featured,Instant updated,boolean cover,long episodes,Instant latest,long views) { }
 public List<Summary> summaries(){return jdbc.query("SELECT w.id,w.title,w.author,w.is_banner,w.is_featured,w.updated_at,EXISTS(SELECT 1 FROM work_cover c WHERE c.work_id=w.id),COUNT(e.id),MAX(p.published_at),COALESCE(SUM(vc.view_count),0)"+PUBLIC+" JOIN work_episode we ON we.episode_id=e.id JOIN work w ON w.id=we.work_id AND w.is_public=1 LEFT JOIN episode_view_count vc ON vc.episode_id=e.id GROUP BY w.id",(rs,n)->new Summary(rs.getLong(1),rs.getString(2),rs.getString(3),rs.getBoolean(4),rs.getBoolean(5),rs.getTimestamp(6).toInstant(),rs.getBoolean(7),rs.getLong(8),rs.getTimestamp(9).toInstant(),rs.getLong(10)));}
 public List<Map<String,Object>> episodes(long work){return jdbc.query("SELECT e.id,we.episode_no,e.title,p.published_at"+PUBLIC+" JOIN work_episode we ON we.episode_id=e.id WHERE we.work_id=? ORDER BY we.episode_no",(rs,n)->Map.<String,Object>of("episodeId",Long.toString(rs.getLong(1)),"episodeNo",rs.getInt(2),"title",rs.getString(3),"publishedAt",rs.getTimestamp(4).toInstant()),work);}
 public List<Map<String,Object>> latest(){return jdbc.query("SELECT e.id,e.title,p.published_at,w.id,w.title,CASE WHEN w.id IS NULL THEN NULL ELSE we.episode_no END"+PUBLIC+" LEFT JOIN work_episode we ON we.episode_id=e.id LEFT JOIN work w ON w.id=we.work_id AND w.is_public=1 ORDER BY p.published_at DESC,e.id DESC LIMIT 12",(rs,n)->{var row=new LinkedHashMap<String,Object>();row.put("episodeId",Long.toString(rs.getLong(1)));row.put("title",rs.getString(2));row.put("publishedAt",rs.getTimestamp(3).toInstant());Long id=rs.getObject(4,Long.class);row.put("workId",id==null?null:Long.toString(id));row.put("workTitle",rs.getString(5));row.put("episodeNo",rs.getObject(6,Integer.class));return row;});}
 public Map<String,Object> episodeWork(long episode){var rows=jdbc.query("SELECT w.id,w.title,w.reading_direction,we.episode_no"+PUBLIC+" JOIN work_episode we ON we.episode_id=e.id JOIN work w ON w.id=we.work_id AND w.is_public=1 WHERE e.id=?",(rs,n)->Map.<String,Object>of("workId",Long.toString(rs.getLong(1)),"title",rs.getString(2),"readingDirection",rs.getString(3),"episodeNo",rs.getInt(4)),episode);return rows.isEmpty()?null:rows.get(0);}
 public long recommendCount(long id){return jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=?",Long.class,id);}
}
