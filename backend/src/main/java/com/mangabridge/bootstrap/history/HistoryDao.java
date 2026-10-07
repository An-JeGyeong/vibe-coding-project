package com.mangabridge.bootstrap.history;

import static com.mangabridge.bootstrap.history.HistoryModels.*;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class HistoryDao {
    private final JdbcTemplate jdbc;
    public HistoryDao(JdbcTemplate jdbc) { this.jdbc=jdbc; }
    private record Where(String sql,List<Object> args) { }
    private static Where where(Filter filter) {
        var sql=new StringBuilder(" WHERE 1=1");var args=new ArrayList<Object>();
        if(filter.episodeId()!=null) {sql.append(" AND d.episode_id=?");args.add(filter.episodeId());}
        if(filter.event()!=null) {sql.append(" AND d.event=?");args.add(filter.event());}
        return new Where(sql.toString(),args);
    }
    public long count(Filter filter) {
        var where=where(filter);
        return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit d"+where.sql(),Long.class,where.args().toArray());
    }
    public List<Item> items(Filter filter) {
        var where=where(filter);var args=new ArrayList<>(where.args());args.add(filter.limit());args.add(filter.offset().longValueExact());
        String sql="SELECT d.id,d.occurred_at,d.event,a.id,a.display_name,d.episode_id,e.title,d.source_version,"
                +"CASE WHEN d.event IN ('TRANSLATION_CREATED','TRANSLATION_SUBMITTED','REVIEW_APPROVED','REVIEW_REJECTED','APPROVAL_INVALIDATED','TRANSLATION_PUBLISHED','PUBLICATION_HELD','PUBLICATION_RESUMED') THEN t.version_no ELSE NULL END,"
                +"s.id,s.display_name FROM domain_audit d JOIN demo_account a ON a.id=d.actor_account_id "
                +"LEFT JOIN episode e ON e.id=d.episode_id LEFT JOIN translation_version t ON t.id=d.translation_version_id AND t.episode_id=d.episode_id "
                +"LEFT JOIN demo_account s ON s.id=d.subject_account_id AND d.event='ASSIGNED'"
                +where.sql()+" ORDER BY d.occurred_at DESC,d.id DESC LIMIT ? OFFSET ?";
        return jdbc.query(sql,(rs,n)->{
            Long episode=rs.getObject(6,Long.class),subject=rs.getObject(10,Long.class);
            return new Item(Long.toString(rs.getLong(1)),rs.getTimestamp(2).toInstant(),rs.getString(3),
                    new Account(Long.toString(rs.getLong(4)),rs.getString(5)),episode==null?null:episode.toString(),rs.getString(7),
                    rs.getObject(8,Integer.class),rs.getObject(9,Integer.class),subject==null?null:new Account(subject.toString(),rs.getString(11)));
        },args.toArray());
    }
}
