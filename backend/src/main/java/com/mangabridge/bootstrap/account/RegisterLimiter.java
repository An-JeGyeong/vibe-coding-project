package com.mangabridge.bootstrap.account;

import java.time.Clock;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * Sign-up attempts are limited per source address (5 per hour) and in total (300 per day), successes and failures alike (CONTRACTS 32.2).
 * The counters live in this server's memory: they reset on restart and are not shared between servers.
 */
@Component
public class RegisterLimiter {
    static final int PER_ADDRESS = 5, PER_ADDRESS_SECONDS = 3600, TOTAL = 300, TOTAL_SECONDS = 86400;
    private final Clock clock;
    private final Map<String, Deque<Instant>> byAddress = new HashMap<>();
    private final Deque<Instant> all = new ArrayDeque<>();

    public RegisterLimiter(Clock clock) { this.clock = clock; }

    /** Counts this attempt, or throws 429 with the seconds until a slot frees up. */
    synchronized void attempt(String address) {
        Instant now = clock.instant();
        evict(all, now.minusSeconds(TOTAL_SECONDS));
        Deque<Instant> mine = byAddress.computeIfAbsent(address, key -> new ArrayDeque<>());
        evict(mine, now.minusSeconds(PER_ADDRESS_SECONDS));
        if (byAddress.size() > 10_000) byAddress.values().removeIf(Deque::isEmpty);
        if (mine.size() >= PER_ADDRESS) throw AccountFailure.rateLimited(wait(mine.peekFirst(), PER_ADDRESS_SECONDS, now));
        if (all.size() >= TOTAL) throw AccountFailure.rateLimited(wait(all.peekFirst(), TOTAL_SECONDS, now));
        mine.addLast(now);
        all.addLast(now);
    }

    private static void evict(Deque<Instant> window, Instant limit) {
        while (!window.isEmpty() && !window.peekFirst().isAfter(limit)) window.removeFirst();
    }

    private static long wait(Instant oldest, int windowSeconds, Instant now) {
        long millis = java.time.Duration.between(now, oldest.plusSeconds(windowSeconds)).toMillis();
        return Math.max(1, (millis + 999) / 1000); // rounded up: never earlier than the slot frees
    }
}
