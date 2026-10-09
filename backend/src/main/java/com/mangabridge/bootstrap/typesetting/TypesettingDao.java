package com.mangabridge.bootstrap.typesetting;
import java.time.Instant;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository public class TypesettingDao {
 private final JdbcTemplate jdbc; public TypesettingDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public record Item(int versionNo,int sourceVersion,Instant decidedAt){}
 public List<Item> approved(long episode){return jdbc.query("SELECT t.version_no,t.source_version_no,r.decided_at FROM translation_version t JOIN review_decision r ON r.translation_version_id=t.id WHERE t.episode_id=? AND t.status='APPROVED' ORDER BY t.version_no DESC",(rs,n)->new Item(rs.getInt(1),rs.getInt(2),rs.getTimestamp(3).toInstant()),episode);}
}
