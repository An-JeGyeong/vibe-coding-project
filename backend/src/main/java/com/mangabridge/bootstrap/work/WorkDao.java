package com.mangabridge.bootstrap.work;
import static com.mangabridge.bootstrap.work.WorkModels.*;
import com.mangabridge.bootstrap.page.PageModels.Image;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;
@Repository
public class WorkDao {
 private final JdbcTemplate jdbc;
 public WorkDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public Row row(long id,boolean lock){var rows=jdbc.query("SELECT id,title,author,description,reading_direction,is_public,is_featured,is_banner,revision,updated_at FROM work WHERE id=?"+(lock?" FOR UPDATE":""),(rs,n)->new Row(rs.getLong(1),rs.getString(2),rs.getString(3),rs.getString(4),rs.getString(5),rs.getBoolean(6),rs.getBoolean(7),rs.getBoolean(8),rs.getInt(9),rs.getTimestamp(10).toInstant()),id);return rows.isEmpty()?null:rows.get(0);}
 // All work updates acquire this same ordered lock before the target lock, serializing the global banner limit.
 public void lockWorks(){jdbc.queryForList("SELECT id FROM work ORDER BY id FOR UPDATE",Long.class);}
 public long create(Values v,long actor,Instant now){var key=new GeneratedKeyHolder();jdbc.update(c->{var ps=c.prepareStatement("INSERT INTO work(title,author,description,reading_direction,is_public,is_featured,is_banner,revision,created_by,created_at,updated_at) VALUES (?,?,?,?,0,0,0,1,?,?,?)",Statement.RETURN_GENERATED_KEYS);ps.setString(1,v.title());ps.setString(2,v.author());ps.setString(3,v.description());ps.setString(4,v.direction());ps.setLong(5,actor);ps.setTimestamp(6,Timestamp.from(now));ps.setTimestamp(7,Timestamp.from(now));return ps;},key);long id=key.getKey().longValue();genres(id,v.genres());return id;}
 public void update(long id,Values v,int revision,Instant now){jdbc.update("UPDATE work SET title=?,author=?,description=?,reading_direction=?,is_public=?,is_featured=?,is_banner=?,revision=?,updated_at=? WHERE id=?",v.title(),v.author(),v.description(),v.direction(),v.isPublic(),v.featured(),v.banner(),revision,Timestamp.from(now),id);genres(id,v.genres());}
 public List<String> genres(long id){return jdbc.queryForList("SELECT genre FROM work_genre WHERE work_id=? ORDER BY genre",String.class,id);}
 public void genres(long id,List<String> genres){jdbc.update("DELETE FROM work_genre WHERE work_id=?",id);for(String genre:genres)jdbc.update("INSERT INTO work_genre(work_id,genre) VALUES (?,?)",id,genre);}
 public long count(){return jdbc.queryForObject("SELECT COUNT(*) FROM work",Long.class);}
 public List<Long> ids(int limit,long offset){return jdbc.queryForList("SELECT id FROM work ORDER BY id DESC LIMIT ? OFFSET ?",Long.class,limit,offset);}
 public long banners(){return jdbc.queryForObject("SELECT COUNT(*) FROM work WHERE is_banner=1",Long.class);}
 public boolean hasCover(long id){return jdbc.queryForObject("SELECT COUNT(*) FROM work_cover WHERE work_id=?",Integer.class,id)>0;}
 public Image cover(long id){var rows=jdbc.query("SELECT content_type,image_data FROM work_cover WHERE work_id=?",(rs,n)->new Image(rs.getString(1),rs.getBytes(2)),id);return rows.isEmpty()?null:rows.get(0);}
 public void cover(long id,String type,byte[] bytes,long actor,Instant now){jdbc.update("INSERT INTO work_cover(work_id,content_type,byte_size,image_data,uploaded_by,updated_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE content_type=VALUES(content_type),byte_size=VALUES(byte_size),image_data=VALUES(image_data),uploaded_by=VALUES(uploaded_by),updated_at=VALUES(updated_at)",id,type,bytes.length,bytes,actor,Timestamp.from(now));}
 public long episodes(long id,boolean published){return jdbc.queryForObject("SELECT COUNT(*) FROM work_episode we JOIN episode e ON e.id=we.episode_id LEFT JOIN translation_version t ON t.id=e.published_translation_version_id WHERE we.work_id=?"+(published?" AND t.status='PUBLISHED'":""),Long.class,id);}
 public List<Map<String,Object>> episodeItems(long id){return jdbc.query("SELECT e.id,we.episode_no,e.title,COALESCE(t.status='PUBLISHED',0) FROM work_episode we JOIN episode e ON e.id=we.episode_id LEFT JOIN translation_version t ON t.id=e.published_translation_version_id WHERE we.work_id=? ORDER BY we.episode_no",(rs,n)->Map.<String,Object>of("episodeId",Long.toString(rs.getLong(1)),"episodeNo",rs.getInt(2),"title",rs.getString(3),"published",rs.getBoolean(4)),id);}
 public Map<String,Object> link(long episode){var rows=jdbc.query("SELECT w.id,w.title,we.episode_no FROM work_episode we JOIN work w ON w.id=we.work_id WHERE we.episode_id=?",(rs,n)->Map.<String,Object>of("workId",Long.toString(rs.getLong(1)),"title",rs.getString(2),"episodeNo",rs.getInt(3)),episode);return rows.isEmpty()?null:rows.get(0);}
 public void link(long episode,long work,int no){jdbc.update("INSERT INTO work_episode(episode_id,work_id,episode_no) VALUES (?,?,?) ON DUPLICATE KEY UPDATE work_id=VALUES(work_id),episode_no=VALUES(episode_no)",episode,work,no);}
 public boolean numberTaken(long work,int no,long episode){return jdbc.queryForObject("SELECT COUNT(*) FROM work_episode WHERE work_id=? AND episode_no=? AND episode_id<>?",Integer.class,work,no,episode)>0;}
 public void unlink(long episode){jdbc.update("DELETE FROM work_episode WHERE episode_id=?",episode);}
}
