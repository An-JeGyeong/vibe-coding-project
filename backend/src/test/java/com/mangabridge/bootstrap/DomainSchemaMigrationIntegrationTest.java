package com.mangabridge.bootstrap;

import static org.assertj.core.api.Assertions.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.TimeUnit;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.callback.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/** Each case owns a fresh --rm/tmpfs MySQL. Never cleans or resets the development schema. */
class DomainSchemaMigrationIntegrationTest {
    /** Local migration runner, available only on the test classpath, never in the operating JAR. */
    public static void main(String[] args) {
        var source=new DriverManagerDataSource();
        source.setUrl(Objects.requireNonNull(System.getenv("DB_URL")));
        source.setConnectionProperties(DomainSchemaConstraintsIntegrationTest.properties(
                Objects.requireNonNull(System.getenv("DB_USERNAME")),Objects.requireNonNull(System.getenv("DB_PASSWORD"))));
        var configuration=Flyway.configure().dataSource(source);
        if(System.getenv("SCHEMA_TARGET")!=null) configuration.target(System.getenv("SCHEMA_TARGET"));
        var flyway=configuration.load();
        int executed=flyway.migrate().migrationsExecuted;
        flyway.validate();
        System.out.println("Schema migration executed="+executed+"; current="+flyway.info().current().getVersion()+"; validate=PASS");
    }
    private static final List<String> OLD_TABLES=List.of("demo_account","auth_token","auth_login_limit","auth_audit",
            "episode","episode_source_version","source_block","domain_audit");
    @Test void emptyDatabaseMigratesAllThirtyOneAndValidatesTwice() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var restored=new ChecksRestored();
            var flyway=Flyway.configure().dataSource(mysql.source).callbacks(restored).load();
            assertThat(flyway.migrate().migrationsExecuted).isEqualTo(31);
            assertThat(restored.versions).containsExactlyInAnyOrder("24","25","27","28");
            flyway.validate();
            assertThat(flyway.migrate().migrationsExecuted).isZero();
            flyway.validate();
            for(String table:OLD_TABLES) assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isZero();
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1",Integer.class)).isEqualTo(31);
        }
    }
    @Test void populatedV9UpgradePreservesEveryOldColumnAndChecksum() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var baseline=Flyway.configure().dataSource(mysql.source).target("9").load();
            assertThat(baseline.migrate().migrationsExecuted).isEqualTo(9);
            populate(mysql.jdbc);
            var counts=new TreeMap<String,Integer>(); var columns=new TreeMap<String,List<String>>();
            var contents=new TreeMap<String,String>();
            for(String table:OLD_TABLES) {
                counts.put(table,mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class));
                assertThat(counts.get(table)).as("baseline fixture exists: "+table).isPositive();
                columns.put(table,mysql.jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",String.class,table));
                contents.put(table,digest(mysql.source,table,columns.get(table)));
            }
            var checksums=mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
            var upgrade=Flyway.configure().dataSource(mysql.source).load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(22);
            upgrade.validate();
            assertThat(upgrade.migrate().migrationsExecuted).isZero();
            upgrade.validate();
            assertThat(mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history WHERE CAST(version AS UNSIGNED)<=9 ORDER BY installed_rank")).isEqualTo(checksums);
            for(String table:OLD_TABLES) {
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).as(table+" count unchanged").isEqualTo(counts.get(table));
                assertThat(digest(mysql.source,table,columns.get(table))).as(table+" old-column digest unchanged").isEqualTo(contents.get(table));
            }
            for(String table:List.of("episode_assignment","translation_version","translation_block","review_decision","publication"))
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isZero();
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM episode WHERE latest_translation_version=0 AND published_translation_version_id IS NULL",Integer.class)).isEqualTo(1);
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE translation_version_id IS NULL",Integer.class)).isEqualTo(1);
        }
    }
    private static class ChecksRestored implements Callback {
        final Set<String> versions=new HashSet<>();
        @Override public boolean supports(Event event,Context context) {return event==Event.AFTER_EACH_MIGRATE;}
        @Override public boolean canHandleInTransaction(Event event,Context context) {return true;}
        @Override public String getCallbackName() {return "verify-fk-checks-restored";}
        @Override public void handle(Event event,Context context) {
            String version=context.getMigrationInfo().getVersion().getVersion();
            if(!Set.of("24","25","27","28").contains(version)) return;
            // Observe the actual migration connection, before Flyway closes/restores it.
            try(var statement=context.getConnection().createStatement();var rows=statement.executeQuery("SELECT @@foreign_key_checks")) {
                assertThat(rows.next()).isTrue(); assertThat(rows.getInt(1)).isEqualTo(1); versions.add(version);
            } catch(SQLException e) {throw new IllegalStateException("Migration connection FK restoration check failed");}
        }
    }
    @Test void populatedV19CorrectionPreservesDataChecksumsAndConstraintDefinitions() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var baseline=Flyway.configure().dataSource(mysql.source).target("19").load();
            assertThat(baseline.migrate().migrationsExecuted).isEqualTo(19);
            populate(mysql.jdbc);
            var contents=new TreeMap<String,String>(); var columns=new TreeMap<String,List<String>>();
            var counts=new TreeMap<String,Integer>();
            for(String table:OLD_TABLES) {
                columns.put(table,mysql.jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",String.class,table));
                contents.put(table,digest(mysql.source,table,columns.get(table)));
                counts.put(table,mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class));
            }
            String fkSql="SELECT CONSTRAINT_NAME,TABLE_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME";
            String uniqueSql="SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND NON_UNIQUE=0 ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX";
            String checkSql="SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY CONSTRAINT_NAME";
            var foreignKeys=mysql.jdbc.queryForList(fkSql); var uniques=mysql.jdbc.queryForList(uniqueSql); var checks=canonicalChecks(mysql.jdbc.queryForList(checkSql));
            String expression=canonicalAsciiExpression(mysql.jdbc.queryForObject("SELECT GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='translation_version' AND COLUMN_NAME='open_slot'",String.class));
            var checksums=mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
            var restored=new ChecksRestored();
            var upgrade=Flyway.configure().dataSource(mysql.source).target("25").callbacks(restored).load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(6);
            assertThat(restored.versions).containsExactlyInAnyOrder("24","25");
            upgrade.validate(); assertThat(upgrade.migrate().migrationsExecuted).isZero(); upgrade.validate();
            assertThat(mysql.jdbc.queryForList(fkSql)).isEqualTo(foreignKeys);
            assertThat(mysql.jdbc.queryForList(uniqueSql)).isEqualTo(uniques);
            assertThat(canonicalChecks(mysql.jdbc.queryForList(checkSql))).isEqualTo(checks);
            assertThat(canonicalAsciiExpression(mysql.jdbc.queryForObject("SELECT GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='translation_version' AND COLUMN_NAME='open_slot'",String.class))).isEqualTo(expression);
            assertThat(mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history WHERE CAST(version AS UNSIGNED)<=19 ORDER BY installed_rank")).isEqualTo(checksums);
            for(String table:OLD_TABLES) {
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isEqualTo(counts.get(table));
                assertThat(digest(mysql.source,table,columns.get(table))).as(table+" unchanged").isEqualTo(contents.get(table));
            }
            assertThat(mysql.jdbc.queryForObject("SELECT @@foreign_key_checks",Integer.class)).isEqualTo(1);
        }
    }
    @Test void v26PreservesAllV25RowsAndAuditColumnsAndChecksums() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var baseline=Flyway.configure().dataSource(mysql.source).target("25").load();
            assertThat(baseline.migrate().migrationsExecuted).isEqualTo(25);
            populate(mysql.jdbc);
            var contents=new TreeMap<String,String>(); var columns=new TreeMap<String,List<String>>();
            var counts=new TreeMap<String,Integer>();
            for(String table:OLD_TABLES) {
                columns.put(table,mysql.jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",String.class,table));
                contents.put(table,digest(mysql.source,table,columns.get(table)));
                counts.put(table,mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class));
            }
            var checksums=mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
            var upgrade=Flyway.configure().dataSource(mysql.source).target("26").load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(1);
            upgrade.validate(); assertThat(upgrade.migrate().migrationsExecuted).isZero(); upgrade.validate();
            assertThat(mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history WHERE CAST(version AS UNSIGNED)<=25 ORDER BY installed_rank")).isEqualTo(checksums);
            for(String table:OLD_TABLES) {
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isEqualTo(counts.get(table));
                assertThat(digest(mysql.source,table,columns.get(table))).as(table+" V26 unchanged").isEqualTo(contents.get(table));
            }
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE subject_account_id IS NULL",Integer.class)).isEqualTo(1);
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit' AND COLUMN_NAME='subject_account_id' AND DATA_TYPE='bigint' AND IS_NULLABLE='YES'",Integer.class)).isEqualTo(1);
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='domain_audit' AND COLUMN_NAME='subject_account_id' AND REFERENCED_TABLE_NAME IS NOT NULL",Integer.class)).isZero();
        }
    }
    @Test void populatedV26CorrectionPreservesRowsChecksumsAndAllConstraintDefinitions() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var baseline=Flyway.configure().dataSource(mysql.source).target("26").load();
            assertThat(baseline.migrate().migrationsExecuted).isEqualTo(26);
            populate(mysql.jdbc);
            var tables=new ArrayList<>(OLD_TABLES);
            tables.addAll(List.of("episode_assignment","translation_version","translation_block","review_decision","publication"));
            var columns=new TreeMap<String,List<String>>(); var counts=new TreeMap<String,Integer>();
            var contents=new TreeMap<String,String>();
            for(String table:tables) {
                columns.put(table,mysql.jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",String.class,table));
                counts.put(table,mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class));
                contents.put(table,digest(mysql.source,table,columns.get(table)));
            }
            String fkSql="SELECT CONSTRAINT_NAME,TABLE_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME";
            String fkColumnsSql="SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,ORDINAL_POSITION,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION";
            String indexSql="SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX";
            String checkSql="SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() ORDER BY CONSTRAINT_NAME";
            String columnSql="SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_DEFAULT,DATETIME_PRECISION,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION";
            var foreignKeys=mysql.jdbc.queryForList(fkSql); var fkColumns=mysql.jdbc.queryForList(fkColumnsSql);
            var indexes=mysql.jdbc.queryForList(indexSql); var checks=canonicalChecks(mysql.jdbc.queryForList(checkSql));
            var definitions=mysql.jdbc.queryForList(columnSql);
            assertThat(foreignKeys).hasSize(19);
            // Preserve the exact existing rules, including legacy V1/V6~V9 NO ACTION definitions.
            var checksums=mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
            var restored=new ChecksRestored();
            var upgrade=Flyway.configure().dataSource(mysql.source).target("30").callbacks(restored).load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(4);
            assertThat(restored.versions).containsExactlyInAnyOrder("27","28");
            upgrade.validate(); assertThat(upgrade.migrate().migrationsExecuted).isZero(); upgrade.validate();
            assertThat(mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history WHERE CAST(version AS UNSIGNED)<=26 ORDER BY installed_rank")).isEqualTo(checksums);
            assertThat(mysql.jdbc.queryForList(fkSql)).isEqualTo(foreignKeys);
            assertThat(mysql.jdbc.queryForList(fkColumnsSql)).isEqualTo(fkColumns);
            assertThat(mysql.jdbc.queryForList(indexSql)).isEqualTo(indexes);
            assertThat(canonicalChecks(mysql.jdbc.queryForList(checkSql))).isEqualTo(checks);
            assertThat(mysql.jdbc.queryForList(columnSql)).isEqualTo(definitions);
            for(String table:tables) {
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).as(table+" count").isEqualTo(counts.get(table));
                assertThat(digest(mysql.source,table,columns.get(table))).as(table+" content").isEqualTo(contents.get(table));
            }
            assertThat(mysql.jdbc.queryForObject("SELECT @@foreign_key_checks",Integer.class)).isEqualTo(1);
        }
    }
    @Test void v31PreservesAllPopulatedV30RowsAndAddsRequiredRevisionDefault() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var baseline=Flyway.configure().dataSource(mysql.source).target("30").load();
            assertThat(baseline.migrate().migrationsExecuted).isEqualTo(30); populate(mysql.jdbc);
            long episode=mysql.jdbc.queryForObject("SELECT id FROM episode",Long.class);
            long translator=mysql.jdbc.queryForObject("SELECT id FROM demo_account WHERE role='TRANSLATOR'",Long.class);
            long reviewer=mysql.jdbc.queryForObject("SELECT id FROM demo_account WHERE role='REVIEWER'",Long.class);
            long operator=mysql.jdbc.queryForObject("SELECT id FROM demo_account WHERE role='OPERATOR'",Long.class);
            mysql.jdbc.update("INSERT INTO episode_assignment VALUES (?,'TRANSLATOR',?,?,UTC_TIMESTAMP(6))",episode,translator,operator);
            for(String status:List.of("PUBLISHED","DRAFT")) {
                int number=status.equals("PUBLISHED")?1:2;
                mysql.jdbc.update("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at) VALUES (?,?,1,?,?,UTC_TIMESTAMP(6))",episode,number,status,translator);
                long id=mysql.jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=? AND version_no=?",Long.class,episode,number);
                mysql.jdbc.update("INSERT INTO translation_block VALUES (?,?,1,1,' preserved translation ')",id,episode);
                if(number==1) {
                    mysql.jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) VALUES (?,'APPROVED',?,1,UTC_TIMESTAMP(6))",id,reviewer);
                    mysql.jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,1,?,UTC_TIMESTAMP(6))",episode,id,operator);
                    mysql.jdbc.update("UPDATE episode SET published_translation_version_id=?,latest_translation_version=2 WHERE id=?",id,episode);
                }
            }
            var tables=new ArrayList<>(OLD_TABLES);tables.addAll(List.of("episode_assignment","translation_version","translation_block","review_decision","publication"));
            var columns=new TreeMap<String,List<String>>();var counts=new TreeMap<String,Integer>();var contents=new TreeMap<String,String>();
            for(String table:tables) {
                columns.put(table,mysql.jdbc.queryForList("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION",String.class,table));
                counts.put(table,mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class));
                assertThat(counts.get(table)).as(table+" populated baseline").isPositive();
                contents.put(table,digest(mysql.source,table,columns.get(table)));
            }
            var checksums=mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history ORDER BY installed_rank");
            var upgrade=Flyway.configure().dataSource(mysql.source).load();
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(1);upgrade.validate();
            assertThat(upgrade.migrate().migrationsExecuted).isZero();upgrade.validate();
            assertThat(mysql.jdbc.queryForList("SELECT version,checksum FROM flyway_schema_history WHERE CAST(version AS UNSIGNED)<=30 ORDER BY installed_rank")).isEqualTo(checksums);
            for(String table:tables) {
                assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isEqualTo(counts.get(table));
                assertThat(digest(mysql.source,table,columns.get(table))).as(table+" unchanged old columns").isEqualTo(contents.get(table));
            }
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM translation_version WHERE draft_revision=1",Integer.class)).isEqualTo(2);
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='translation_version' AND COLUMN_NAME='draft_revision' AND COLUMN_TYPE='int' AND IS_NULLABLE='NO' AND COLUMN_DEFAULT='1'",Integer.class)).isEqualTo(1);
        }
    }
    private String canonicalAsciiExpression(String expression) {
        // ALTER rewrites introducers for the same ASCII-only enum literals; preserve all other SQL text.
        assertThat(expression.chars().allMatch(c->c<128)).as("only ASCII literals can share this comparison").isTrue();
        return expression.replace("_utf8mb4", "_ascii");
    }
    private List<Map<String,Object>> canonicalChecks(List<Map<String,Object>> rows) {
        return rows.stream().map(row->{var copy=new LinkedHashMap<String,Object>(row);
            copy.put("CHECK_CLAUSE",canonicalAsciiExpression((String)row.get("CHECK_CLAUSE"))); return (Map<String,Object>)copy;}).toList();
    }
    private void populate(JdbcTemplate jdbc) {
        for(String role:List.of("OPERATOR","TRANSLATOR","REVIEWER","READER"))
            jdbc.update("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)","demo."+role.toLowerCase(Locale.ROOT),"migration fixture",role,"unused-test-only");
        long actor=jdbc.queryForObject("SELECT id FROM demo_account WHERE role='OPERATOR'",Long.class);
        jdbc.update("INSERT INTO auth_token VALUES (UNHEX(SHA2('isolated fixture token',256)),?,DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 HOUR),NULL)",actor);
        jdbc.update("INSERT INTO auth_login_limit VALUES (UNHEX(SHA2('isolated fixture limit',256)),2,UTC_TIMESTAMP(6),NULL,UTC_TIMESTAMP(6))");
        jdbc.update("INSERT INTO auth_audit(occurred_at,account_id,event,reason) VALUES (UTC_TIMESTAMP(6),?,'LOGIN_SUCCESS','SUCCESS')",actor);
        jdbc.update("INSERT INTO episode(title,latest_source_version,created_by,created_at,updated_at) VALUES ('  retained title  ',1,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))",actor);
        long episode=jdbc.queryForObject("SELECT id FROM episode",Long.class);
        jdbc.update("INSERT INTO episode_source_version VALUES (?,1,?,UTC_TIMESTAMP(6),2)",episode,actor);
        jdbc.update("INSERT INTO source_block VALUES (?,1,1,1,'  retained source  '),(?,1,2,NULL,'다국어 원문')",episode,episode);
        jdbc.update("INSERT INTO domain_audit(occurred_at,actor_account_id,event,episode_id,source_version) VALUES (UTC_TIMESTAMP(6),?,'SOURCE_SAVED',?,1)",actor,episode);
    }
    private String digest(DriverManagerDataSource source,String table,List<String> columns) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        String names=String.join(",",columns.stream().map(c->"`"+c+"`").toList());
        try(var connection=source.getConnection(); var statement=connection.createStatement();
            var rows=statement.executeQuery("SELECT "+names+" FROM "+table+" ORDER BY "+names)) {
            while(rows.next()) for(int i=1;i<=columns.size();i++) {
                byte[] value=rows.getBytes(i);
                // Length prefixes distinguish NULL, empty strings, row boundaries and binary values.
                digest.update(java.nio.ByteBuffer.allocate(4).putInt(value==null?-1:value.length).array());
                if(value!=null) digest.update(value);
            }
        }
        return HexFormat.of().formatHex(digest.digest());
    }
    private static String docker(Map<String,String> environment,String... args) throws Exception {
        var command=new ArrayList<String>(); command.add("docker"); command.addAll(List.of(args));
        var builder=new ProcessBuilder(command).redirectErrorStream(true); builder.environment().putAll(environment);
        var process=builder.start();
        process.getOutputStream().close();
        if(!process.waitFor(30,TimeUnit.SECONDS)) { process.destroyForcibly(); throw new IllegalStateException("Docker operation timed out"); }
        byte[] output=process.getInputStream().readAllBytes();
        // Do not include arbitrary Docker output or environment secrets in assertions/logs.
        assertThat(process.exitValue()).as("Docker "+args[0]+" exit").isZero();
        return new String(output,StandardCharsets.UTF_8).trim();
    }
    private static class DisposableMySql implements AutoCloseable {
        final String id;
        final DriverManagerDataSource source;
        final JdbcTemplate jdbc;
        DisposableMySql() throws Exception {
            byte[] random=new byte[32]; new SecureRandom().nextBytes(random);
            String password=HexFormat.of().formatHex(random);
            id=docker(Map.of("MYSQL_DATABASE","schema_upgrade","MYSQL_USER","schema_fixture","MYSQL_PASSWORD",password,"MYSQL_RANDOM_ROOT_PASSWORD","yes"),
                    "run","-d","--rm","--pull=never","--name","mangabridge-schema-test-"+UUID.randomUUID(),
                    "--publish","127.0.0.1::3306","--tmpfs","/var/lib/mysql:rw",
                    "--env","MYSQL_DATABASE","--env","MYSQL_USER","--env","MYSQL_PASSWORD","--env","MYSQL_RANDOM_ROOT_PASSWORD",
                    "mysql:8.4.11","--character-set-server=utf8mb4","--collation-server=utf8mb4_0900_ai_ci","--default-time-zone=+00:00");
            try {
                String mapping=docker(Map.of(),"port",id,"3306/tcp");
                assertThat(mapping).startsWith("127.0.0.1:");
                String port=mapping.substring(mapping.lastIndexOf(':')+1);
                source=new DriverManagerDataSource(); source.setUrl("jdbc:mysql://127.0.0.1:"+port+"/schema_upgrade");
                source.setConnectionProperties(DomainSchemaConstraintsIntegrationTest.properties("schema_fixture",password));
                long deadline=System.nanoTime()+Duration.ofSeconds(60).toNanos(); boolean ready=false;
                while(System.nanoTime()<deadline) {
                    try(var connection=source.getConnection(); var statement=connection.createStatement(); var rows=statement.executeQuery("SELECT 1")) {
                        ready=rows.next() && rows.getInt(1)==1; if(ready) break;
                    } catch(SQLException expectedStartup) { Thread.sleep(500); }
                }
                assertThat(ready).as("real MySQL application-account readiness").isTrue();
                jdbc=new JdbcTemplate(source); jdbc.setQueryTimeout(2);
                assertThat(jdbc.queryForObject("SELECT VERSION()",String.class)).startsWith("8.4.11");
            } catch(Throwable failure) { close(); throw failure; }
        }
        @Override public void close() throws Exception { docker(Map.of(),"stop","--time","10",id); }
    }
}
