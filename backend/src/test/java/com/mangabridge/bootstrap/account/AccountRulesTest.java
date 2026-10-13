package com.mangabridge.bootstrap.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

/** Field rules and the sign-up limiter of CONTRACTS 32.2, without a database. */
class AccountRulesTest {
    @Test void loginIdBoundariesAndReservedPrefix() {
        assertThat(AccountRules.loginId("abc")).isFalse();                 // 3 characters
        assertThat(AccountRules.loginId("abcd")).isTrue();                 // 4
        assertThat(AccountRules.loginId("a".repeat(20))).isTrue();         // 20
        assertThat(AccountRules.loginId("a".repeat(21))).isFalse();        // 21
        assertThat(AccountRules.loginId("demo.operator")).isFalse();       // reserved for the seeded accounts
        assertThat(AccountRules.loginId("demo")).isTrue();                 // valid: only the prefix "demo." is reserved
        assertThat(AccountRules.loginId("demonstration")).isTrue();        // only the "demo." prefix is reserved
        for (String bad : new String[]{"Abcd", "ab cd", "한글아이디", "-abcd", ".abcd", "abcd!", "abcd\n", null})
            assertThat(AccountRules.loginId(bad)).as(String.valueOf(bad)).isFalse();
        assertThat(AccountRules.loginId("a.b_c-d9")).isTrue();
    }

    @Test void passwordBoundariesAndWeakValues() {
        assertThat(AccountRules.password("reader01", "Abcdefgh1")).isFalse();                 // 9 characters
        assertThat(AccountRules.password("reader01", "Abcdefghi1")).isTrue();                 // 10
        assertThat(AccountRules.password("reader01", "a1".repeat(36))).isTrue();              // 72 bytes
        assertThat(AccountRules.password("reader01", "a1".repeat(36) + "x")).isFalse();       // 73 bytes
        assertThat(AccountRules.password("reader01", "가나다라마바사아자차카타파하거너더러머버서어저처")).isTrue(); // 24 characters, 72 bytes in UTF-8
        assertThat(AccountRules.password("reader01", "가나다라마바사아자차카타파하거너더러머버서어저처커")).isFalse(); // 25 characters, 75 bytes
        assertThat(AccountRules.password("reader01", "xxReader01xx")).isFalse();              // contains the login id
        assertThat(AccountRules.password("reader01", "XXREADER01XX")).isFalse();              // ... in any case
        assertThat(AccountRules.password("reader01", "1234567890")).isFalse();                // common
        assertThat(AccountRules.password("reader01", "Password")).isFalse();
        assertThat(AccountRules.password("reader01", "PASSWORD123")).isFalse();
        assertThat(AccountRules.password("reader01", "aaaaaaaaaaaa")).isFalse();              // one character repeated
        assertThat(AccountRules.password("reader01", "          ")).isFalse();               // blanks only
        assertThat(AccountRules.password("reader01", null)).isFalse();
        assertThat(AccountRules.password("reader01", "")).isFalse();
    }

    @Test void displayNameAndBio() {
        assertThat(AccountRules.displayName("  독자  ")).isEqualTo("독자");
        assertThat(AccountRules.displayName("")).isNull();
        assertThat(AccountRules.displayName("   ")).isNull();
        assertThat(AccountRules.displayName("가".repeat(20))).isNotNull();
        assertThat(AccountRules.displayName("가".repeat(21))).isNull();
        assertThat(AccountRules.displayName("a\u0007b")).isNull();
        assertThat(AccountRules.displayName("a\nb")).isNull();
        assertThat(AccountRules.displayName("😀".repeat(20))).isNotNull();      // counted in code points
        assertThat(AccountRules.displayName("😀".repeat(21))).isNull();
        assertThat(AccountRules.displayName(null)).isNull();
        assertThat(AccountRules.bio("")).isEqualTo("");
        assertThat(AccountRules.bio("  안녕  ")).isEqualTo("안녕");
        assertThat(AccountRules.bio("a".repeat(100))).isNotNull();
        assertThat(AccountRules.bio("a".repeat(101))).isNull();
        assertThat(AccountRules.bio("two\nlines")).isNull();
        assertThat(AccountRules.bio(null)).isNull();
    }

    static final class MutableClock extends Clock {
        final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-13T00:00:00Z"));
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now.get(); }
        void advance(Duration duration) { now.updateAndGet(value -> value.plus(duration)); }
    }

    @Test void fiveAttemptsPerAddressPerHourThenTheWindowSlides() {
        var clock = new MutableClock();
        var limiter = new RegisterLimiter(clock);
        for (int i = 0; i < 5; i++) { limiter.attempt("1.1.1.1"); clock.advance(Duration.ofMinutes(1)); }
        assertThatThrownBy(() -> limiter.attempt("1.1.1.1")).isInstanceOfSatisfying(AccountFailure.class, failure -> {
            assertThat(failure.status).isEqualTo(429);
            assertThat(failure.code).isEqualTo("REGISTER_RATE_LIMITED");
            assertThat(failure.retryAfterSeconds).isBetween(1L, 3600L);
        });
        limiter.attempt("2.2.2.2");                                  // another address is unaffected
        clock.advance(Duration.ofMinutes(56));                       // 61 minutes after the first attempt
        limiter.attempt("1.1.1.1");                                  // the oldest attempt left the window
        assertThatThrownBy(() -> { for (int i = 0; i < 5; i++) limiter.attempt("1.1.1.1"); }).isInstanceOf(AccountFailure.class);
    }

    @Test void retryAfterIsTheTimeUntilTheOldestAttemptLeavesTheWindow() {
        var clock = new MutableClock();
        var limiter = new RegisterLimiter(clock);
        for (int i = 0; i < 5; i++) limiter.attempt("1.1.1.1");
        clock.advance(Duration.ofMinutes(10));
        assertThatThrownBy(() -> limiter.attempt("1.1.1.1")).isInstanceOfSatisfying(AccountFailure.class,
                failure -> assertThat(failure.retryAfterSeconds).isEqualTo(3000L));
    }

    @Test void threeHundredAttemptsPerDayInTotalAcrossAddresses() {
        var clock = new MutableClock();
        var limiter = new RegisterLimiter(clock);
        for (int i = 0; i < 300; i++) { limiter.attempt("10.0." + (i / 5) + "." + (i % 5)); } // never more than one per address
        assertThatThrownBy(() -> limiter.attempt("9.9.9.9")).isInstanceOfSatisfying(AccountFailure.class,
                failure -> assertThat(failure.code).isEqualTo("REGISTER_RATE_LIMITED"));
        clock.advance(Duration.ofHours(24).plusSeconds(1));
        limiter.attempt("9.9.9.9");
    }

    @Test void aRefusedAttemptIsNotCounted() {
        var clock = new MutableClock();
        var limiter = new RegisterLimiter(clock);
        for (int i = 0; i < 5; i++) limiter.attempt("1.1.1.1");
        for (int i = 0; i < 20; i++) assertThatThrownBy(() -> limiter.attempt("1.1.1.1")).isInstanceOf(AccountFailure.class);
        clock.advance(Duration.ofSeconds(3601));
        limiter.attempt("1.1.1.1");     // refused tries did not extend the block
    }
}
