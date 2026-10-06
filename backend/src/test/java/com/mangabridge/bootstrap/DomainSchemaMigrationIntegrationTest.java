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
    @Test void emptyDatabaseMigratesAllNineteenAndValidatesTwice() throws Exception {
        try(var mysql=new DisposableMySql()) {
            var flyway=Flyway.configure().dataSource(mysql.source).load();
            assertThat(flyway.migrate().migrationsExecuted).isEqualTo(19);
            flyway.validate();
            assertThat(flyway.migrate().migrationsExecuted).isZero();
            flyway.validate();
            for(String table:OLD_TABLES) assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM "+table,Integer.class)).isZero();
            assertThat(mysql.jdbc.queryForObject("SELECT COUNT(*) FROM flyway_schema_history WHERE success=1",Integer.class)).isEqualTo(19);
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
            assertThat(upgrade.migrate().migrationsExecuted).isEqualTo(10);
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
