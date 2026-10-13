package com.mangabridge.bootstrap.work;
import java.time.LocalDate;
import java.sql.Date;
import java.sql.Timestamp;
import java.time.ZoneOffset;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
@Repository
public class RankingDao {
 private final JdbcTemplate jdbc;public RankingDao(JdbcTemplate jdbc){this.jdbc=jdbc;}
 public long views(long work,LocalDate from,LocalDate through){return jdbc.queryForObject("SELECT COALESCE(SUM(d.view_count),0) FROM work_episode we JOIN episode e ON e.id=we.episode_id JOIN translation_version t ON t.id=e.published_translation_version_id AND t.episode_id=e.id AND t.status='PUBLISHED' JOIN episode_view_daily d ON d.episode_id=e.id WHERE we.work_id=? AND d.view_date BETWEEN ? AND ?",Long.class,work,Date.valueOf(from),Date.valueOf(through));}
 public long recommends(long work,LocalDate from,LocalDate through){return jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=? AND created_at>=? AND created_at<?",Long.class,work,Timestamp.from(from.atStartOfDay(ZoneOffset.UTC).toInstant()),Timestamp.from(through.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant()));}
}
