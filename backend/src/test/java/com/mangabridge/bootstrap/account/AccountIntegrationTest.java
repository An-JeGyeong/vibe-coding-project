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
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.AfterEach;
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

/** CONTRACTS 32.2 and 32.3 against a real MySQL: sign-up, its limit, the profile and the password. */
@SpringBootTest(classes = MangabridgeApplication.class, webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers = RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(AccountIntegrationTest.Fixtures.class)
class AccountIntegrationTest {
    static final AccountRulesTest.MutableClock CLOCK = new AccountRulesTest.MutableClock();
    @TestConfiguration static class Fixtures {
        @Bean @Primary RegisterLimiter testLimiter() { return new RegisterLimiter(CLOCK); }
    }

    @Autowired JdbcTemplate jdbc;
    @LocalServerPort int port;
    final ObjectMapper mapper = new ObjectMapper();
    final HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    static final AtomicInteger SEQUENCE = new AtomicInteger();
    final List<String> created = new ArrayList<>();
    static final String PASSWORD = "Reader-pass-1";

    record Result(int status, JsonNode body, HttpResponse<String> raw) {
        String header(String name) { return raw.headers().firstValue(name).orElse(null); }
    }

    Result call(String method, String path, String body, String token, String address) throws Exception {
        var builder = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).timeout(Duration.ofSeconds(20))
                .method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body))
                .header("X-Forwarded-For", address);
        if (body != null) builder.header("Content-Type", "application/json");
        if (token != null) builder.header("Authorization", "Bearer " + token);
        var response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        JsonNode json = null;
        try { json = response.body().isEmpty() ? null : mapper.readTree(response.body()); } catch (Exception notJson) { /* checked by the test */ }
        return new Result(response.statusCode(), json, response);
    }
    String address() { return "10." + SEQUENCE.incrementAndGet() / 250 + "." + SEQUENCE.get() % 250 + ".1"; } // a fresh address per call site
    String id() { return "t32" + Long.toString(System.nanoTime() % 1_000_000_000L, 36) + SEQUENCE.incrementAndGet(); }
    String registerBody(String loginId, String password, String name) throws Exception {
        return mapper.writeValueAsString(Map.of("loginId", loginId, "password", password, "displayName", name));
    }
    Result register(String loginId, String password, String name) throws Exception {
        created.add(loginId);
        return call("POST", "/api/auth/register", registerBody(loginId, password, name), null, address());
    }
    String registered(String name) throws Exception {
        String loginId = id();
        Result result = register(loginId, PASSWORD, name);
        assertThat(result.status()).isEqualTo(201);
        return result.body().path("accessToken").asText();
    }
    void error(Result result, int status, String code) {
        assertThat(result.status()).isEqualTo(status);
        assertThat(result.header("Cache-Control")).isEqualTo("no-store");
        assertThat(result.body().path("error").path("code").asText()).isEqualTo(code);
        assertThat(result.body().path("error").fieldNames().next()).isNotNull();
    }
    long accountId(String loginId) { return jdbc.queryForObject("SELECT id FROM demo_account WHERE login_id=?", Long.class, loginId); }
    int count(String loginId) { return jdbc.queryForObject("SELECT COUNT(*) FROM demo_account WHERE login_id=?", Integer.class, loginId); }

    @AfterEach void cleanup() {
        for (String loginId : created) {
            var ids = jdbc.queryForList("SELECT id FROM demo_account WHERE login_id=?", Long.class, loginId);
            for (long id : ids) {
                jdbc.update("DELETE FROM auth_token WHERE account_id=?", id);
                jdbc.update("DELETE FROM auth_audit WHERE account_id=?", id);
                jdbc.update("DELETE FROM account_profile WHERE account_id=?", id);
                jdbc.update("DELETE FROM demo_account WHERE id=?", id);
            }
        }
        created.clear();
        jdbc.update("DELETE FROM auth_audit WHERE account_id IS NULL AND occurred_at>?", java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(600)));
    }

    @Test void signUpCreatesAReaderAndOpensASession() throws Exception {
        String loginId = id();
        Result result = register(loginId, PASSWORD, "  새 독자  ");
        assertThat(result.status()).isEqualTo(201);
        assertThat(result.header("Cache-Control")).isEqualTo("no-store");
        JsonNode body = result.body();
        assertThat(body.fieldNames()).toIterable().containsExactlyInAnyOrder("user", "accessToken", "tokenType", "expiresAt");
        assertThat(body.path("user").path("role").asText()).isEqualTo("READER");
        assertThat(body.path("user").path("displayName").asText()).isEqualTo("새 독자");
        assertThat(body.path("user").path("id").isTextual()).isTrue();
        assertThat(body.path("tokenType").asText()).isEqualTo("Bearer");
        assertThat(body.path("accessToken").asText()).matches("[A-Za-z0-9_-]{43}");
        assertThat(result.raw().body()).doesNotContain(PASSWORD);

        long id = accountId(loginId);
        assertThat(jdbc.queryForObject("SELECT role FROM demo_account WHERE id=?", String.class, id)).isEqualTo("READER");
        String hash = jdbc.queryForObject("SELECT password_hash FROM demo_account WHERE id=?", String.class, id);
        assertThat(hash).startsWith("$2").contains("$12$").doesNotContain(PASSWORD);
        assertThat(jdbc.queryForObject("SELECT bio FROM account_profile WHERE account_id=?", String.class, id)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE account_id=? AND event='REGISTER' AND reason='SUCCESS'", Integer.class, id)).isEqualTo(1);

        String token = body.path("accessToken").asText();
        Result me = call("GET", "/api/auth/me", null, token, address());
        assertThat(me.status()).isEqualTo(200);
        assertThat(me.body().path("user").path("id").asText()).isEqualTo(Long.toString(id));
        Result login = call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginId, "password", PASSWORD)), null, address());
        assertThat(login.status()).isEqualTo(200);
        assertThat(login.body().path("user").path("role").asText()).isEqualTo("READER");
    }

    @Test void aStrayInvalidAuthorizationHeaderDoesNotBlockSignUp() throws Exception {
        String loginId = id();
        created.add(loginId);
        Result result = call("POST", "/api/auth/register", registerBody(loginId, PASSWORD, "독자"), "not-a-valid-token", address());
        assertThat(result.status()).isEqualTo(201);
    }

    @Test void everyInvalidFieldIsTheSameFixedBadRequestAndCreatesNothing() throws Exception {
        String ok = id();
        String[][] bad = {
                {"abc", PASSWORD, "독자"}, {"a".repeat(21), PASSWORD, "독자"}, {"Upper01x", PASSWORD, "독자"}, {"한글아이디", PASSWORD, "독자"},
                {"demo.reader2", PASSWORD, "독자"}, {ok, "short-1", "독자"}, {ok, "1234567890", "독자"}, {ok, "aaaaaaaaaaaa", "독자"},
                {ok, ok + "-extra", "독자"}, {ok, PASSWORD, ""}, {ok, PASSWORD, "   "}, {ok, PASSWORD, "가".repeat(21)}, {ok, PASSWORD, "a\u0007b"},
                {ok, "a1".repeat(36) + "x", "독자"}};
        for (String[] row : bad) {
            Result result = call("POST", "/api/auth/register", registerBody(row[0], row[1], row[2]), null, address());
            error(result, 400, "INVALID_REQUEST");
            assertThat(result.raw().body()).doesNotContain(row[1]).doesNotContain(row[0]);
        }
        for (String raw : new String[]{"{bad", "[]", "null", "\"x\"", "{\"loginId\":\"abcd1234\"}",
                "{\"loginId\":\"abcd1234\",\"password\":\"Reader-pass-1\",\"displayName\":\"독자\",\"role\":\"OPERATOR\"}",
                "{\"loginId\":5,\"password\":\"Reader-pass-1\",\"displayName\":\"독자\"}",
                "{\"loginId\":\"abcd1234\",\"password\":null,\"displayName\":\"독자\"}"})
            error(call("POST", "/api/auth/register", raw, null, address()), 400, "INVALID_REQUEST");
        error(call("POST", "/api/auth/register", null, null, address()), 400, "INVALID_REQUEST");
        assertThat(count(ok)).isZero();
        assertThat(count("abcd1234")).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM demo_account WHERE login_id LIKE 'demo.reader2'", Integer.class)).isZero();
    }

    @Test void theSameLoginIdIsTakenAndConcurrentSignUpsCreateOne() throws Exception {
        String loginId = id();
        assertThat(register(loginId, PASSWORD, "첫째").status()).isEqualTo(201);
        error(register(loginId, "Another-pass-2", "둘째"), 409, "LOGIN_ID_TAKEN");
        assertThat(jdbc.queryForObject("SELECT display_name FROM demo_account WHERE login_id=?", String.class, loginId)).isEqualTo("첫째");

        String racing = id();
        created.add(racing);
        var first = CompletableFuture.supplyAsync(() -> run(racing, "동시1"));
        var second = CompletableFuture.supplyAsync(() -> run(racing, "동시2"));
        var statuses = List.of(first.get().status(), second.get().status());
        assertThat(statuses).containsExactlyInAnyOrder(201, 409);
        assertThat(count(racing)).isEqualTo(1);
    }
    Result run(String loginId, String name) {
        try { return call("POST", "/api/auth/register", registerBody(loginId, PASSWORD, name), null, address()); }
        catch (Exception failure) { throw new IllegalStateException(failure); }
    }

    @Test void fiveAttemptsPerAddressPerHourThenTooManyWithRetryAfter() throws Exception {
        String address = "203.0.113." + (SEQUENCE.incrementAndGet() % 200);
        for (int i = 0; i < 5; i++) {
            String loginId = id();
            created.add(loginId);
            Result result = call("POST", "/api/auth/register", i % 2 == 0 ? registerBody(loginId, PASSWORD, "독자") : "{bad", null, address);
            assertThat(result.status()).isIn(201, 400);   // failures count as attempts too
        }
        Result limited = call("POST", "/api/auth/register", registerBody(id(), PASSWORD, "독자"), null, address);
        error(limited, 429, "REGISTER_RATE_LIMITED");
        assertThat(Long.parseLong(limited.header("Retry-After"))).isBetween(1L, 3600L);
        assertThat(register(id(), PASSWORD, "다른 주소").status()).isEqualTo(201);   // another address is unaffected
        CLOCK.advance(Duration.ofMinutes(61));
        String again = id();
        created.add(again);
        assertThat(call("POST", "/api/auth/register", registerBody(again, PASSWORD, "독자"), null, address).status()).isEqualTo(201);
    }

    @Test void theLastForwardedAddressIsTheOneThatCounts() throws Exception {
        String proxy = "198.51.100." + (SEQUENCE.incrementAndGet() % 200);
        for (int i = 0; i < 5; i++) {
            String loginId = id();
            created.add(loginId);
            // the first value is client-chosen and changes every time; the last one is the proxy's and stays
            assertThat(call("POST", "/api/auth/register", registerBody(loginId, PASSWORD, "독자"), null, "7.7.7." + i + ", " + proxy).status()).isEqualTo(201);
        }
        error(call("POST", "/api/auth/register", registerBody(id(), PASSWORD, "독자"), null, "9.9.9.9, " + proxy), 429, "REGISTER_RATE_LIMITED");
    }

    @Test void aReaderCannotUseTheWorkTools() throws Exception {
        String token = registered("독자");
        for (String path : new String[]{"/api/episodes", "/api/works", "/api/history", "/api/assignable-accounts", "/api/my/reviews", "/api/my/episodes/1/translations"}) {
            Result result = call("GET", path, null, token, address());
            assertThat(result.status()).as(path).isEqualTo(403);
        }
        assertThat(call("POST", "/api/episodes", "{\"title\":\"x\"}", token, address()).status()).isEqualTo(403);
    }

    @Test void theProfileCanBeReadAndEditedByItsOwnerOnly() throws Exception {
        String loginId = id();
        created.add(loginId);
        String token = call("POST", "/api/auth/register", registerBody(loginId, PASSWORD, "독자"), null, address()).body().path("accessToken").asText();
        String other = registered("다른 독자");

        Result read = call("GET", "/api/me/profile", null, token, address());
        assertThat(read.status()).isEqualTo(200);
        assertThat(read.header("Cache-Control")).isEqualTo("no-store");
        assertThat(read.body().fieldNames()).toIterable().containsExactlyInAnyOrder("loginId", "displayName", "bio", "role");
        assertThat(read.body().path("loginId").asText()).isEqualTo(loginId);
        assertThat(read.body().path("bio").asText()).isEmpty();
        assertThat(read.raw().body()).doesNotContain("password").doesNotContain("$2");

        Result patch = call("PATCH", "/api/me/profile", "{\"displayName\":\"  바뀐 이름 \",\"bio\":\" 만화를 읽습니다 \"}", token, address());
        assertThat(patch.status()).isEqualTo(200);
        assertThat(patch.body().path("displayName").asText()).isEqualTo("바뀐 이름");
        assertThat(patch.body().path("bio").asText()).isEqualTo("만화를 읽습니다");
        assertThat(call("GET", "/api/auth/me", null, token, address()).body().path("user").path("displayName").asText()).isEqualTo("바뀐 이름");
        assertThat(call("GET", "/api/me/profile", null, other, address()).body().path("displayName").asText()).isEqualTo("다른 독자");
        assertThat(call("PATCH", "/api/me/profile", "{\"displayName\":\"x\",\"bio\":\"\"}", token, address()).status()).isEqualTo(200); // an empty bio is allowed

        for (String raw : new String[]{"{\"displayName\":\"\",\"bio\":\"\"}", "{\"displayName\":\"" + "가".repeat(21) + "\",\"bio\":\"\"}",
                "{\"displayName\":\"x\",\"bio\":\"" + "a".repeat(101) + "\"}", "{\"displayName\":\"x\",\"bio\":\"a\\nb\"}",
                "{\"displayName\":\"x\"}", "{\"bio\":\"\"}", "{\"displayName\":\"x\",\"bio\":\"\",\"role\":\"OPERATOR\"}", "{bad", "[]"})
            error(call("PATCH", "/api/me/profile", raw, token, address()), 400, "INVALID_REQUEST");
        assertThat(call("GET", "/api/me/profile", null, token, address()).body().path("displayName").asText()).isEqualTo("x");
        assertThat(jdbc.queryForObject("SELECT role FROM demo_account WHERE login_id=?", String.class, loginId)).isEqualTo("READER");

        assertThat(call("GET", "/api/me/profile", null, null, address()).status()).isEqualTo(401);
        assertThat(call("PATCH", "/api/me/profile", "{\"displayName\":\"x\",\"bio\":\"\"}", null, address()).status()).isEqualTo(401);
        assertThat(call("GET", "/api/me/profile", null, "x".repeat(43), address()).status()).isEqualTo(401);
    }

    @Test void changingThePasswordRevokesTheOtherTokensAndKeepsTheCurrentOne() throws Exception {
        String loginId = id();
        created.add(loginId);
        String current = call("POST", "/api/auth/register", registerBody(loginId, PASSWORD, "독자"), null, address()).body().path("accessToken").asText();
        String second = call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginId, "password", PASSWORD)), null, address()).body().path("accessToken").asText();
        assertThat(call("GET", "/api/auth/me", null, second, address()).status()).isEqualTo(200);

        String newPassword = "A-newer-pass-2";
        Result changed = call("POST", "/api/me/password", mapper.writeValueAsString(Map.of("currentPassword", PASSWORD, "newPassword", newPassword)), current, address());
        assertThat(changed.status()).isEqualTo(204);
        assertThat(changed.header("Cache-Control")).isEqualTo("no-store");
        assertThat(call("GET", "/api/auth/me", null, current, address()).status()).isEqualTo(200);   // the token in use stays valid
        assertThat(call("GET", "/api/auth/me", null, second, address()).status()).isEqualTo(401);    // every other token is gone
        assertThat(call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginId, "password", PASSWORD)), null, address()).status()).isEqualTo(401);
        assertThat(call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginId, "password", newPassword)), null, address()).status()).isEqualTo(200);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE account_id=? AND event='PASSWORD_CHANGED'", Integer.class, accountId(loginId))).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT password_hash FROM demo_account WHERE login_id=?", String.class, loginId)).doesNotContain(newPassword);

        error(call("POST", "/api/me/password", mapper.writeValueAsString(Map.of("currentPassword", "wrong-password-1", "newPassword", "Yet-another-pass-3")), current, address()), 400, "INVALID_CURRENT_PASSWORD");
        for (String weak : new String[]{"short-1", "1234567890", loginId + "-x1", "bbbbbbbbbbbb"}) {
            Result result = call("POST", "/api/me/password", mapper.writeValueAsString(Map.of("currentPassword", newPassword, "newPassword", weak)), current, address());
            error(result, 400, "INVALID_REQUEST");
            assertThat(result.raw().body()).doesNotContain(weak).doesNotContain(newPassword);
        }
        for (String raw : new String[]{"{\"currentPassword\":\"x\"}", "{\"newPassword\":\"Valid-pass-9x\"}", "{bad", "[]", "{\"currentPassword\":\"\",\"newPassword\":\"Valid-pass-9x\"}"})
            error(call("POST", "/api/me/password", raw, current, address()), 400, "INVALID_REQUEST");
        assertThat(call("POST", "/api/auth/login", mapper.writeValueAsString(Map.of("loginId", loginId, "password", newPassword)), null, address()).status()).isEqualTo(200);
        assertThat(call("POST", "/api/me/password", "{\"currentPassword\":\"x\",\"newPassword\":\"Valid-pass-9x\"}", null, address()).status()).isEqualTo(401);
    }

    @Test void theSignUpEndpointAcceptsPostOnly() throws Exception {
        assertThat(call("GET", "/api/auth/register", null, null, address()).status()).isIn(401, 405);
        assertThat(call("PUT", "/api/auth/register", "{}", null, address()).status()).isIn(401, 405);
        assertThat(call("DELETE", "/api/auth/register", null, null, address()).status()).isIn(401, 405);
    }
}
