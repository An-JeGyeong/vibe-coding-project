package com.mangabridge.bootstrap.account;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.ContextConfiguration;

/** CONTRACTS 32.4 and 32.5 against a real MySQL: library, recent episodes and account recommendations. */
@SpringBootTest(classes = MangabridgeApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers = RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(MeIntegrationTest.Fixtures.class)
class MeIntegrationTest {
    @TestConfiguration static class Fixtures {
        @Bean @Primary RegisterLimiter meTestLimiter() { return new RegisterLimiter(AccountIntegrationTest.CLOCK); }
    }

    @Autowired JdbcTemplate jdbc;
    @LocalServerPort int port;
    final ObjectMapper mapper = new ObjectMapper();
    final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    static final AtomicInteger SEQUENCE = new AtomicInteger(1000);
    static final String PASSWORD = "Reader-pass-1";
    final List<Long> accounts = new ArrayList<>(), works = new ArrayList<>(), episodes = new ArrayList<>();
    final List<String> loginIds = new ArrayList<>();
    String alice, bob;           // tokens of two readers
    long aliceId, bobId;

    record Result(int status, JsonNode body, HttpResponse<String> raw) {
        String header(String name) { return raw.headers().firstValue(name).orElse(null); }
    }

    Result call(String method, String path, String body, String token) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(20))
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body))
                .header("X-Forwarded-For", "10.9." + SEQUENCE.incrementAndGet() / 250 + "." + SEQUENCE.get() % 250);
        if (body != null) builder.header("Content-Type", "application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode json = null;
        try { json = response.body().isEmpty() ? null : mapper.readTree(response.body()); } catch (Exception notJson) { /* checked by the test */ }
        return new Result(response.statusCode(), json, response);
    }

    String signUp(String name) throws Exception {
        String loginId = "t32m" + Long.toString(System.nanoTime() % 1_000_000_000L, 36) + SEQUENCE.incrementAndGet();
        loginIds.add(loginId);
        Result result = call("POST", "/api/auth/register", mapper.writeValueAsString(Map.of("loginId", loginId, "password", PASSWORD, "displayName", name)), null);
        assertThat(result.status()).isEqualTo(201);
        accounts.add(Long.parseLong(result.body().path("user").path("id").asText()));
        return result.body().path("accessToken").asText();
    }

    @BeforeEach void signedUp() throws Exception {
        alice = signUp("앨리스"); aliceId = accounts.get(0);
        bob = signUp("밥"); bobId = accounts.get(1);
    }

    // ---- fixtures written straight into the tables ----
    long newWork(boolean isPublic) {
        var key = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(c -> {
            var ps = c.prepareStatement("INSERT INTO work(title,author,description,reading_direction,is_public,is_featured,is_banner,revision,created_by,created_at,updated_at) VALUES ('t32 work','author','',?,?,0,0,1,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, "RTL"); ps.setBoolean(2, isPublic); ps.setLong(3, aliceId);
            return ps;
        }, key);
        long id = key.getKey().longValue();
        works.add(id);
        return id;
    }
    long plainEpisode() {
        var key = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(c -> {
            var ps = c.prepareStatement("INSERT INTO episode(title,created_by,created_at,updated_at) VALUES ('t32 episode',?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, aliceId);
            return ps;
        }, key);
        long id = key.getKey().longValue();
        episodes.add(id);
        return id;
    }
    /** A published episode, linked to the work when one is given. */
    long publishedEpisode(Long work, int number) {
        long e = plainEpisode();
        if (work != null) jdbc.update("INSERT INTO work_episode(episode_id,work_id,episode_no) VALUES (?,?,?)", e, work, number);
        jdbc.update("INSERT INTO episode_source_version(episode_id,version_no,created_by,created_at,block_count) VALUES (?,1,?,UTC_TIMESTAMP(6),1)", e, aliceId);
        jdbc.update("INSERT INTO source_block(episode_id,version_no,seq,page_no,body) VALUES (?,1,1,1,'source')", e);
        jdbc.update("UPDATE episode SET latest_source_version=1 WHERE id=?", e);
        var key = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(c -> {
            var ps = c.prepareStatement("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at,draft_revision) VALUES (?,1,1,'PUBLISHED',?,UTC_TIMESTAMP(6),1)", java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setLong(1, e); ps.setLong(2, aliceId);
            return ps;
        }, key);
        long v = key.getKey().longValue();
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,1,1,'public text')", v, e);
        jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,1,?,?)", e, v, aliceId, Timestamp.from(Instant.parse("2026-10-09T00:00:00Z")));
        jdbc.update("UPDATE episode SET published_translation_version_id=? WHERE id=?", v, e);
        return e;
    }
    long publicWork() { long w = newWork(true); publishedEpisode(w, 1); return w; }

    @AfterEach void cleanup() {
        for (long id : accounts) {
            jdbc.update("DELETE FROM account_library WHERE account_id=?", id);
            jdbc.update("DELETE FROM account_recent WHERE account_id=?", id);
        }
        for (long id : works) {
            jdbc.update("DELETE FROM work_recommend WHERE work_id=?", id);
            jdbc.update("DELETE FROM account_library WHERE work_id=?", id);
        }
        for (long id : episodes) {
            jdbc.update("DELETE FROM account_recent WHERE episode_id=?", id);
            jdbc.update("DELETE FROM work_episode WHERE episode_id=?", id);
            jdbc.update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?", id);
            jdbc.update("DELETE FROM publication WHERE episode_id=?", id);
            jdbc.update("DELETE FROM translation_block WHERE episode_id=?", id);
            jdbc.update("DELETE FROM translation_version WHERE episode_id=?", id);
            jdbc.update("DELETE FROM source_block WHERE episode_id=?", id);
            jdbc.update("DELETE FROM episode_source_version WHERE episode_id=?", id);
            jdbc.update("DELETE FROM episode WHERE id=?", id);
        }
        for (long id : works) jdbc.update("DELETE FROM work WHERE id=?", id);
        for (long id : accounts) {
            jdbc.update("DELETE FROM auth_token WHERE account_id=?", id);
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?", id);
            jdbc.update("DELETE FROM account_profile WHERE account_id=?", id);
            jdbc.update("DELETE FROM demo_account WHERE id=?", id);
        }
        accounts.clear(); works.clear(); episodes.clear(); loginIds.clear();
    }

    List<String> ids(Result result, String field, String item) {
        var list = new ArrayList<String>();
        for (JsonNode node : result.body().path(field)) list.add(item == null ? node.asText() : node.path(item).asText());
        return list;
    }
    List<String> library(String token) throws Exception { return ids(call("GET", "/api/me/library", null, token), "items", "workId"); }
    List<String> recent(String token) throws Exception { return ids(call("GET", "/api/me/recent", null, token), "items", "episodeId"); }
    void error(Result result, int status, String code) {
        assertThat(result.status()).isEqualTo(status);
        assertThat(result.header("Cache-Control")).isEqualTo("no-store");
        assertThat(result.body().path("error").path("code").asText()).isEqualTo(code);
    }
    String s(long value) { return Long.toString(value); }

    @Test void libraryAddsListsKeepsOrderAndRemovesIdempotently() throws Exception {
        long a = publicWork(), b = publicWork();
        Result added = call("PUT", "/api/me/library/" + a, null, alice);
        assertThat(added.status()).isEqualTo(204);
        assertThat(added.header("Cache-Control")).isEqualTo("no-store");
        Thread.sleep(5);
        assertThat(call("PUT", "/api/me/library/" + b, null, alice).status()).isEqualTo(204);
        assertThat(library(alice)).containsExactly(s(b), s(a));                 // newest first
        Thread.sleep(5);
        assertThat(call("PUT", "/api/me/library/" + a, null, alice).status()).isEqualTo(204);
        assertThat(library(alice)).containsExactly(s(b), s(a));                 // a work already there keeps its place
        Result listed = call("GET", "/api/me/library", null, alice);
        assertThat(listed.header("Cache-Control")).isEqualTo("no-store");
        assertThat(listed.body().fieldNames()).toIterable().containsExactly("items");
        assertThat(listed.body().path("items").get(0).fieldNames()).toIterable().containsExactly("workId", "addedAt");
        assertThat(listed.body().path("items").get(0).path("workId").isTextual()).isTrue();
        assertThat(Instant.parse(listed.body().path("items").get(0).path("addedAt").asText())).isNotNull();

        assertThat(library(bob)).isEmpty();                                       // another account sees nothing
        assertThat(call("DELETE", "/api/me/library/" + a, null, alice).status()).isEqualTo(204);
        assertThat(call("DELETE", "/api/me/library/" + a, null, alice).status()).isEqualTo(204);   // idempotent
        assertThat(call("DELETE", "/api/me/library/999999999", null, alice).status()).isEqualTo(204);
        assertThat(library(alice)).containsExactly(s(b));
    }

    @Test void onlyPublicWorksCanBeAddedAndPathsAreChecked() throws Exception {
        long hidden = newWork(false);
        publishedEpisode(hidden, 1);
        long noEpisode = newWork(true);
        long held = newWork(true);
        long heldEpisode = publishedEpisode(held, 1);
        jdbc.update("UPDATE translation_version SET status='ON_HOLD' WHERE episode_id=?", heldEpisode);
        for (String work : new String[]{s(hidden), s(noEpisode), s(held), "999999999", "0", "-1", "abc", "01", "1".repeat(19)})
            error(call("PUT", "/api/me/library/" + work, null, alice), 404, "NOT_FOUND");
        assertThat(call("DELETE", "/api/me/library/abc", null, alice).status()).isEqualTo(404);
        assertThat(library(alice)).isEmpty();
    }

    @Test void theLibraryHoldsTwoHundredAndDropsTheOldest() throws Exception {
        var plain = new ArrayList<Long>();
        for (int i = 0; i < 200; i++) plain.add(newWork(false));
        Instant base = Instant.parse("2026-01-01T00:00:00Z");
        for (int i = 0; i < 200; i++) jdbc.update("INSERT INTO account_library(account_id,work_id,added_at) VALUES (?,?,?)", aliceId, plain.get(i), Timestamp.from(base.plusSeconds(i)));
        long fresh = publicWork();
        assertThat(call("PUT", "/api/me/library/" + fresh, null, alice).status()).isEqualTo(204);
        var after = library(alice);
        assertThat(after).hasSize(200).startsWith(s(fresh)).doesNotContain(s(plain.get(0)));   // the oldest went
        assertThat(after).contains(s(plain.get(199)), s(plain.get(1)));
    }

    @Test void mergingAddsNewPublicWorksBehindTheExistingOnesInTheGivenOrder() throws Exception {
        long existing = publicWork(), x = publicWork(), y = publicWork(), z = publicWork(), hidden = newWork(false);
        publishedEpisode(hidden, 1);
        assertThat(call("PUT", "/api/me/library/" + existing, null, alice).status()).isEqualTo(204);
        String body = mapper.writeValueAsString(Map.of("workIds", List.of(s(x), s(hidden), s(y), s(x), "999999999", s(existing), s(z))));
        Result merged = call("POST", "/api/me/library/merge", body, alice);
        assertThat(merged.status()).isEqualTo(200);
        assertThat(ids(merged, "items", "workId")).containsExactly(s(existing), s(x), s(y), s(z)); // existing first, then the browser order
        assertThat(library(alice)).containsExactly(s(existing), s(x), s(y), s(z));
        assertThat(ids(call("POST", "/api/me/library/merge", body, alice), "items", "workId")).containsExactly(s(existing), s(x), s(y), s(z)); // idempotent
        assertThat(library(bob)).isEmpty();
        assertThat(call("POST", "/api/me/library/merge", "{\"workIds\":[]}", bob).status()).isEqualTo(200);
    }

    @Test void mergeValidationIsOneFixedBadRequest() throws Exception {
        var tooMany = new ArrayList<String>();
        for (int i = 1; i <= 201; i++) tooMany.add(Integer.toString(i));
        for (String raw : new String[]{"{bad", "[]", "null", "{}", "{\"workIds\":null}", "{\"workIds\":\"1\"}", "{\"workIds\":[\"abc\"]}", "{\"workIds\":[\"0\"]}",
                "{\"workIds\":[1]}", "{\"workIds\":[\"1\"],\"extra\":1}", mapper.writeValueAsString(Map.of("workIds", tooMany))})
            error(call("POST", "/api/me/library/merge", raw, alice), 400, "INVALID_REQUEST");
        error(call("POST", "/api/me/library/merge", null, alice), 400, "INVALID_REQUEST");
    }

    @Test void recentEpisodesAreUpsertedNewestFirstAndCleared() throws Exception {
        long w = publicWork();
        long e1 = publishedEpisode(w, 2), e2 = publishedEpisode(w, 3);
        assertThat(call("PUT", "/api/me/recent/" + e1, null, alice).status()).isEqualTo(204);
        Thread.sleep(5);
        assertThat(call("PUT", "/api/me/recent/" + e2, null, alice).status()).isEqualTo(204);
        assertThat(recent(alice)).containsExactly(s(e2), s(e1));
        Result before = call("GET", "/api/me/recent", null, alice);
        assertThat(before.body().path("items").get(0).fieldNames()).toIterable().containsExactly("episodeId", "readAt");
        Thread.sleep(5);
        assertThat(call("PUT", "/api/me/recent/" + e1, null, alice).status()).isEqualTo(204);   // read again: moves to the front, no duplicate
        assertThat(recent(alice)).containsExactly(s(e1), s(e2));
        assertThat(recent(bob)).isEmpty();
        assertThat(call("DELETE", "/api/me/recent", null, alice).status()).isEqualTo(204);
        assertThat(call("DELETE", "/api/me/recent", null, alice).status()).isEqualTo(204);       // idempotent
        assertThat(recent(alice)).isEmpty();
    }

    @Test void onlyPublicEpisodesAreRecordedAndTheHistoryHoldsTwenty() throws Exception {
        long held = publishedEpisode(null, 1);
        jdbc.update("UPDATE translation_version SET status='ON_HOLD' WHERE episode_id=?", held);
        long draft = plainEpisode();
        for (String episode : new String[]{s(held), s(draft), "999999999", "0", "abc"})
            error(call("PUT", "/api/me/recent/" + episode, null, alice), 404, "NOT_FOUND");
        var old = new ArrayList<Long>();
        Instant base = Instant.parse("2026-01-01T00:00:00Z");
        for (int i = 0; i < 20; i++) { long e = plainEpisode(); old.add(e); jdbc.update("INSERT INTO account_recent(account_id,episode_id,read_at) VALUES (?,?,?)", aliceId, e, Timestamp.from(base.plusSeconds(i))); }
        long fresh = publishedEpisode(null, 1);
        assertThat(call("PUT", "/api/me/recent/" + fresh, null, alice).status()).isEqualTo(204);
        var after = recent(alice);
        assertThat(after).hasSize(20).startsWith(s(fresh)).doesNotContain(s(old.get(0))).contains(s(old.get(19)));
    }

    @Test void mergingRecentKeepsTheLaterTimeClampsTheFutureAndSkipsHiddenEpisodes() throws Exception {
        long a = publishedEpisode(null, 1), b = publishedEpisode(null, 1), hidden = plainEpisode();
        assertThat(call("PUT", "/api/me/recent/" + a, null, alice).status()).isEqualTo(204);           // read just now
        String old = "2020-01-01T00:00:00Z", future = "2999-01-01T00:00:00Z";
        String body = mapper.writeValueAsString(Map.of("items", List.of(
                Map.of("episodeId", s(a), "readAt", old),                    // older than the server's time: the later one stays
                Map.of("episodeId", s(b), "readAt", future),                 // in the future: clamped to now
                Map.of("episodeId", s(hidden), "readAt", old),               // not public: skipped
                Map.of("episodeId", "999999999", "readAt", old))));
        Result merged = call("POST", "/api/me/recent/merge", body, alice);
        assertThat(merged.status()).isEqualTo(200);
        assertThat(ids(merged, "items", "episodeId")).containsExactlyInAnyOrder(s(a), s(b));
        for (JsonNode item : merged.body().path("items")) assertThat(Instant.parse(item.path("readAt").asText())).isAfter(Instant.parse(old)).isBeforeOrEqualTo(Instant.now().plusSeconds(5));
        assertThat(recent(bob)).isEmpty();
    }

    @Test void recentMergeValidationIsOneFixedBadRequest() throws Exception {
        long e = publishedEpisode(null, 1);
        var tooMany = new ArrayList<Map<String, String>>();
        for (int i = 1; i <= 21; i++) tooMany.add(Map.of("episodeId", Integer.toString(i), "readAt", "2026-01-01T00:00:00Z"));
        for (String raw : new String[]{"{bad", "[]", "{}", "{\"items\":null}", "{\"items\":[{\"episodeId\":\"" + e + "\"}]}", "{\"items\":[{\"episodeId\":\"" + e + "\",\"readAt\":\"yesterday\"}]}",
                "{\"items\":[{\"episodeId\":\"abc\",\"readAt\":\"2026-01-01T00:00:00Z\"}]}", "{\"items\":[null]}", "{\"items\":[],\"extra\":1}", mapper.writeValueAsString(Map.of("items", tooMany))})
            error(call("POST", "/api/me/recent/merge", raw, alice), 400, "INVALID_REQUEST");
    }

    @Test void anAccountRecommendationIsOnePerAccountOnAnyDevice() throws Exception {
        long w = publicWork();
        String mine = "/api/me/works/" + w;
        Result first = call("POST", mine + "/recommend", null, alice);                  // no body: the account is the voter
        assertThat(first.status()).isEqualTo(200);
        assertThat(first.header("Cache-Control")).isEqualTo("no-store");
        assertThat(first.body().fieldNames()).toIterable().containsExactlyInAnyOrder("recommended", "recommendCount");
        assertThat(first.body().path("recommended").asBoolean()).isTrue();
        assertThat(first.body().path("recommendCount").asInt()).isEqualTo(1);
        // another device: a new token of the same account
        String second = call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginIds.get(0), "password", PASSWORD)), null).body().path("accessToken").asText();
        assertThat(call("POST", mine + "/recommend", null, second).body().path("recommendCount").asInt()).isEqualTo(1);   // the same vote
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=? AND voter_key=?", Integer.class, w, MeService.voterKey(aliceId))).isEqualTo(1);
        assertThat(ids(call("GET", "/api/me/recommendations", null, second), "workIds", null)).containsExactly(s(w));
        assertThat(ids(call("GET", "/api/me/recommendations", null, bob), "workIds", null)).isEmpty();

        assertThat(call("POST", mine + "/recommend", null, bob).body().path("recommendCount").asInt()).isEqualTo(2);                       // another account is another vote
        assertThat(call("POST", "/api/public/works/" + w + "/recommend", "{\"voterKey\":\"" + "b".repeat(32) + "\"}", null).body().path("recommendCount").asInt()).isEqualTo(3);   // an anonymous vote counts separately
        Result undone = call("POST", mine + "/unrecommend", null, alice);
        assertThat(undone.status()).isEqualTo(200);
        assertThat(undone.body().path("recommended").asBoolean()).isFalse();
        assertThat(undone.body().path("recommendCount").asInt()).isEqualTo(2);
        assertThat(call("POST", mine + "/unrecommend", null, alice).body().path("recommendCount").asInt()).isEqualTo(2);                      // idempotent
        assertThat(ids(call("GET", "/api/me/recommendations", null, alice), "workIds", null)).isEmpty();
        assertThat(ids(call("GET", "/api/me/recommendations", null, bob), "workIds", null)).containsExactly(s(w));
        Result listed = call("GET", "/api/public/works/" + w, null, null);
        assertThat(listed.status()).isEqualTo(200);
        assertThat(listed.body().path("recommendCount").asInt()).isEqualTo(2);                                                              // the public total counts both kinds
    }

    @Test void thePublicRecommendationStillJudgesNoOneAndTheAccountOnesNeedASignedInAccount() throws Exception {
        long w = publicWork();
        String publicPath = "/api/public/works/" + w + "/recommend", mine = "/api/me/works/" + w + "/recommend";
        // a token on the public endpoint changes nothing: the vote is the anonymous key of the body (CONTRACTS 31.3)
        assertThat(call("POST", publicPath, "{\"voterKey\":\"" + "d".repeat(32) + "\"}", alice).body().path("recommendCount").asInt()).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=? AND voter_key=?", Integer.class, w, "d".repeat(32))).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM work_recommend WHERE work_id=? AND voter_key=?", Integer.class, w, MeService.voterKey(aliceId))).isZero();
        for (String token : new String[]{"x".repeat(43), "short"})
            assertThat(call("POST", publicPath, "{\"voterKey\":\"" + "d".repeat(32) + "\"}", token).status()).isEqualTo(200);        // a bad token is ignored there
        error(call("POST", publicPath, null, alice), 400, "INVALID_REQUEST");                                                           // the anonymous key stays required there

        error(call("POST", mine, null, null), 401, "AUTH_REQUIRED");
        error(call("POST", mine, null, "x".repeat(43)), 401, "AUTH_REQUIRED");
        error(call("POST", "/api/me/works/999999999/recommend", null, alice), 404, "NOT_FOUND");
        error(call("POST", "/api/me/works/abc/unrecommend", null, alice), 404, "NOT_FOUND");
        long hidden = newWork(false);
        publishedEpisode(hidden, 1);
        error(call("POST", "/api/me/works/" + hidden + "/recommend", null, alice), 404, "NOT_FOUND");
        assertThat(call("GET", mine, null, alice).status()).isIn(404, 405);
    }

    @Test void theRecommendationListHidesWorksThatAreNoLongerPublic() throws Exception {
        long visible = publicWork(), later = publicWork();
        assertThat(call("POST", "/api/me/works/" + visible + "/recommend", null, alice).status()).isEqualTo(200);
        assertThat(call("POST", "/api/me/works/" + later + "/recommend", null, alice).status()).isEqualTo(200);
        jdbc.update("UPDATE work SET is_public=0 WHERE id=?", later);
        assertThat(ids(call("GET", "/api/me/recommendations", null, alice), "workIds", null)).containsExactly(s(visible));
    }

    @Test void everyMeEndpointNeedsASignedInAccountAndAnyRoleMayUseThem() throws Exception {
        for (String[] request : new String[][]{{"GET", "/api/me/library"}, {"PUT", "/api/me/library/1"}, {"DELETE", "/api/me/library/1"}, {"POST", "/api/me/library/merge"},
                {"GET", "/api/me/recent"}, {"PUT", "/api/me/recent/1"}, {"DELETE", "/api/me/recent"}, {"POST", "/api/me/recent/merge"}, {"GET", "/api/me/recommendations"}, {"POST", "/api/me/works/1/recommend"}, {"POST", "/api/me/works/1/unrecommend"},
                {"GET", "/api/me/profile"}, {"POST", "/api/me/password"}})
            assertThat(call(request[0], request[1], request[0].equals("POST") && !request[1].contains("/works/") ? "{}" : null, null).status()).as(request[1]).isEqualTo(401);
        assertThat(call("GET", "/api/me/library", null, "x".repeat(43)).status()).isEqualTo(401);
        // an operator account (not a reader) may keep a library too
        var key = new org.springframework.jdbc.support.GeneratedKeyHolder();
        jdbc.update(c -> {
            var ps = c.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)", java.sql.Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, "t32op" + SEQUENCE.incrementAndGet()); ps.setString(2, "op"); ps.setString(3, "OPERATOR"); ps.setString(4, "unused-test-hash");
            return ps;
        }, key);
        long operator = key.getKey().longValue();
        accounts.add(operator);
        byte[] bytes = new byte[32];
        new java.security.SecureRandom().nextBytes(bytes);
        String token = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)", AccountIntegrationTestDigest.digest(token), operator, Timestamp.from(Instant.now().plusSeconds(3600)));
        long w = publicWork();
        assertThat(call("PUT", "/api/me/library/" + w, null, token).status()).isEqualTo(204);
        assertThat(library(token)).containsExactly(s(w));
        assertThat(call("GET", "/api/me/profile", null, token).body().path("role").asText()).isEqualTo("OPERATOR");
    }

    static final class AccountIntegrationTestDigest {
        static byte[] digest(String token) {
            try { return java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
            catch (Exception impossible) { throw new IllegalStateException(impossible); }
        }
    }

    @Test void accountDataIsNeverVisibleToAnotherAccount() throws Exception {
        long w = publicWork();
        long e = publishedEpisode(null, 1);
        assertThat(call("PUT", "/api/me/library/" + w, null, alice).status()).isEqualTo(204);
        assertThat(call("PUT", "/api/me/recent/" + e, null, alice).status()).isEqualTo(204);
        for (String path : new String[]{"/api/me/library", "/api/me/recent", "/api/me/recommendations"}) {
            Result mine = call("GET", path, null, alice), theirs = call("GET", path, null, bob);
            assertThat(theirs.raw().body()).doesNotContain(s(w)).doesNotContain("\"" + s(e) + "\"");
            assertThat(mine.status()).isEqualTo(200);
        }
        assertThat(call("DELETE", "/api/me/library/" + w, null, bob).status()).isEqualTo(204);   // bob's delete touches only bob's rows
        assertThat(library(alice)).containsExactly(s(w));
        assertThat(call("DELETE", "/api/me/recent", null, bob).status()).isEqualTo(204);
        assertThat(recent(alice)).containsExactly(s(e));
    }
}
