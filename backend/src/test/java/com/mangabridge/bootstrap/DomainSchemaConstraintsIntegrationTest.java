package com.mangabridge.bootstrap;

import static org.assertj.core.api.Assertions.*;
import java.sql.*;
import java.util.*;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;

/** Real MySQL only. All fixture writes use one transaction, rolled back after each test. */
class DomainSchemaConstraintsIntegrationTest {
    private Connection db;
    private long operator, translator, reviewer, reader, episode, other;

    static Properties properties(String user, String password) {
        Properties p=new Properties();
        p.setProperty("user",user); p.setProperty("password",password);
        p.setProperty("sslMode","DISABLED"); p.setProperty("allowPublicKeyRetrieval","true");
        p.setProperty("connectTimeout","2000"); p.setProperty("socketTimeout","3000");
        p.setProperty("connectionTimeZone","UTC"); p.setProperty("forceConnectionTimeZoneToSession","true");
        p.setProperty("characterEncoding","UTF-8"); p.setProperty("connectionCollation","utf8mb4_0900_ai_ci");
        return p;
    }
    @BeforeEach void setup() throws Exception {
        db=DriverManager.getConnection(Objects.requireNonNull(System.getenv("DB_URL")),
                properties(System.getenv("DB_USERNAME"),System.getenv("DB_PASSWORD")));
        db.setAutoCommit(false);
        operator=account("OPERATOR"); translator=account("TRANSLATOR");
        reviewer=account("REVIEWER"); reader=account("READER");
        episode=episode(); other=episode();
        source(episode,1,1); source(episode,2,2); source(other,1,1);
    }
    @AfterEach void cleanup() throws Exception {
        if(db!=null) { try { db.rollback(); } finally { db.close(); } }
    }
    private long account(String role) throws SQLException {
        return insert("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",
                "test.schema."+UUID.randomUUID(),"schema fixture",role,"unused-test-only");
    }
    private long episode() throws SQLException {
        return insert("INSERT INTO episode(title,created_by,created_at,updated_at) VALUES (?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))","schema fixture",operator);
    }
    private void source(long ep,int version,int seq) throws SQLException {
        update("INSERT INTO episode_source_version(episode_id,version_no,created_by,created_at,block_count) VALUES (?,?,?,UTC_TIMESTAMP(6),1)",ep,version,operator);
        update("INSERT INTO source_block(episode_id,version_no,seq,body) VALUES (?,?,?,?)",ep,version,seq,"source fixture");
    }
    private long translation(long ep,int number,int source,String status) throws SQLException {
        return insert("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(6))",ep,number,source,status,translator);
    }
    private void block(long id,long ep,int source,int seq,String body) throws SQLException {
        update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,?,?,?)",id,ep,source,seq,body);
    }
    private void decision(long id,String decision,String reason,Timestamp invalidated) throws SQLException {
        update("INSERT INTO review_decision(translation_version_id,decision,reason,reviewer_id,source_version_no,decided_at,invalidated_at) VALUES (?,?,?,?,1,UTC_TIMESTAMP(6),?)",id,decision,reason,reviewer,invalidated);
    }
    private void publish(long ep,long id,int source) throws SQLException {
        update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,?,?,UTC_TIMESTAMP(6))",ep,id,source,operator);
    }
    private PreparedStatement statement(String sql,Object... args) throws SQLException {
        PreparedStatement s=db.prepareStatement(sql,Statement.RETURN_GENERATED_KEYS);
        s.setQueryTimeout(2); for(int i=0;i<args.length;i++) s.setObject(i+1,args[i]); return s;
    }
    private long insert(String sql,Object... args) throws SQLException {
        try(var s=statement(sql,args)) { s.executeUpdate(); try(var keys=s.getGeneratedKeys()) { assertThat(keys.next()).isTrue(); return keys.getLong(1); } }
    }
    private void update(String sql,Object... args) throws SQLException { try(var s=statement(sql,args)) { s.executeUpdate(); } }
    private int count(String sql,Object... args) throws SQLException { try(var s=statement(sql,args); var rows=s.executeQuery()) { rows.next(); return rows.getInt(1); } }
    @FunctionalInterface interface SqlAction { void run() throws SQLException; }
    private void rejected(int code,SqlAction action) {
        try { action.run(); fail("Expected MySQL constraint rejection"); }
        catch(SQLException e) { assertThat(e.getErrorCode()).isEqualTo(code); }
    }
    @Test void assignmentRoleAndPrimaryKeyAndAssignedRoleChange() throws Exception {
        update("INSERT INTO episode_assignment VALUES (?,?,?,?)",episode,"TRANSLATOR",translator,operator);
        update("INSERT INTO episode_assignment VALUES (?,?,?,?)",episode,"REVIEWER",reviewer,operator);
        rejected(1062,()->update("INSERT INTO episode_assignment VALUES (?,?,?,?)",episode,"TRANSLATOR",translator,operator));
        rejected(1452,()->update("INSERT INTO episode_assignment VALUES (?,?,?,?)",other,"TRANSLATOR",reader,operator));
        rejected(1451,()->update("UPDATE demo_account SET role='READER' WHERE id=?",translator));
        rejected(3819,()->update("INSERT INTO episode_assignment VALUES (?,?,?,?)",other,"READER",reader,operator));
        rejected(1451,()->update("DELETE FROM episode WHERE id=?",episode));
    }
    @Test void openVersionUniquenessAndClosedVersionsAllowMultiplicity() throws Exception {
        long draft=translation(episode,1,1,"DRAFT");
        rejected(1062,()->translation(episode,2,1,"DRAFT"));
        rejected(1062,()->translation(episode,2,1,"REVIEW_PENDING"));
        update("UPDATE translation_version SET status='REVIEW_PENDING' WHERE id=?",draft);
        rejected(1062,()->translation(episode,2,1,"DRAFT"));
        rejected(1062,()->translation(episode,2,1,"REVIEW_PENDING"));
        update("UPDATE translation_version SET status='REJECTED' WHERE id=?",draft);
        translation(episode,2,1,"REJECTED"); translation(episode,3,1,"INVALIDATED"); translation(episode,4,1,"INVALIDATED");
        translation(episode,5,1,"APPROVED"); translation(episode,6,1,"PUBLISHED"); translation(episode,7,1,"ON_HOLD");
        translation(episode,8,1,"DRAFT"); translation(other,1,1,"DRAFT");
        assertThat(count("SELECT COUNT(*) FROM translation_version WHERE episode_id=? AND open_slot=1",episode)).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM translation_version WHERE episode_id=? AND open_slot IS NULL",episode)).isEqualTo(7);
    }
    @Test void translationSourceNumberAndStatusConstraints() throws Exception {
        translation(episode,1,1,"REJECTED");
        rejected(1062,()->translation(episode,1,1,"INVALIDATED"));
        rejected(1452,()->translation(episode,2,999,"DRAFT"));
        rejected(3819,()->translation(episode,2,1,"UNKNOWN"));
        rejected(3819,()->translation(episode,2,1,"draft"));
        rejected(3819,()->translation(episode,0,1,"REJECTED"));
    }
    @Test void translationBlockCompositeReferencesAndTextBounds() throws Exception {
        long id=translation(episode,1,1,"DRAFT");
        block(id,episode,1,1,"번역".repeat(2000));
        rejected(1062,()->block(id,episode,1,1,"duplicate"));
        rejected(1452,()->block(id,episode,1,2,"not in source version"));
        rejected(1452,()->block(id,episode,2,2,"other source version"));
        update("INSERT INTO source_block(episode_id,version_no,seq,body) VALUES (?,1,2,'other source fixture')",other);
        rejected(1452,()->block(id,other,1,2,"other episode"));
        long id2=translation(other,1,1,"DRAFT");
        rejected(3819,()->block(id2,other,1,1,""));
        rejected(1048,()->block(id2,other,1,1,null));
        rejected(1406,()->block(id2,other,1,1,"x".repeat(4001)));
        block(id2,other,1,1,"x");
    }
    @Test void reviewDecisionUniquenessReasonAndInvalidation() throws Exception {
        long a=translation(episode,1,1,"APPROVED");
        decision(a,"APPROVED",null,Timestamp.valueOf("2026-01-01 00:00:00"));
        rejected(1062,()->decision(a,"APPROVED",null,null));
        long b=translation(episode,2,1,"REJECTED");
        rejected(3819,()->decision(b,"REJECTED",null,null));
        rejected(3819,()->decision(b,"REJECTED","",null));
        rejected(1406,()->decision(b,"REJECTED","x".repeat(501),null));
        rejected(3819,()->decision(b,"APPROVED","reason",null));
        rejected(3819,()->decision(b,"REJECTED","reason",Timestamp.valueOf("2026-01-01 00:00:00")));
        rejected(3819,()->decision(b,"approved",null,null));
        decision(b,"REJECTED","x".repeat(500),null);
        long c=translation(episode,3,1,"REJECTED"); decision(c,"REJECTED","x",null);
    }
    @Test void publicationAndPointerStayWithinEpisodeAndRepeatedHistoryAllowed() throws Exception {
        long a=translation(episode,1,1,"PUBLISHED"); long b=translation(other,1,1,"PUBLISHED");
        publish(episode,a,1); publish(episode,a,1);
        rejected(1452,()->publish(episode,b,1));
        rejected(1452,()->publish(episode,a,999));
        update("UPDATE episode SET published_translation_version_id=? WHERE id=?",a,episode);
        rejected(1452,()->update("UPDATE episode SET published_translation_version_id=? WHERE id=?",b,episode));
        rejected(1451,()->update("DELETE FROM translation_version WHERE id=?",a));
        update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?",episode);
        assertThat(count("SELECT COUNT(*) FROM episode WHERE id=? AND published_translation_version_id IS NULL",episode)).isEqualTo(1);
    }
    @Test void engineEnumCollationTimePrecisionAndForeignKeyRules() throws Exception {
        assertThat(count("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('episode_assignment','translation_version','translation_block','review_decision','publication') AND ENGINE='InnoDB' AND TABLE_COLLATION='utf8mb4_0900_ai_ci'")).isEqualTo(5);
        assertThat(count("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND (TABLE_NAME,COLUMN_NAME) IN (('episode_assignment','assignee_role'),('translation_version','status'),('review_decision','decision')) AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin'")).isEqualTo(3);
        assertThat(count("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('translation_version','review_decision','publication') AND DATA_TYPE='datetime' AND DATETIME_PRECISION=6")).isEqualTo(5);
        assertThat(count("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('episode_assignment','translation_version','translation_block','review_decision','publication') AND (UPDATE_RULE<>'RESTRICT' OR DELETE_RULE<>'RESTRICT')")).isZero();
        assertThat(count("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_NAME='fk_episode_publication' AND UPDATE_RULE='RESTRICT' AND DELETE_RULE='RESTRICT'")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit' AND COLUMN_NAME='translation_version_id' AND IS_NULLABLE='YES'")).isEqualTo(1);
    }
}
