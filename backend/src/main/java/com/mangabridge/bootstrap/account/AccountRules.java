package com.mangabridge.bootstrap.account;

import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/** Field rules of the sign-up and profile endpoints (CONTRACTS 32.2, 32.3). Every violation is the same 400, so nothing says which rule failed. */
final class AccountRules {
    private AccountRules() { }
    static final Pattern LOGIN_ID = Pattern.compile("^[a-z0-9][a-z0-9._-]{3,19}$");
    static final String RESERVED_PREFIX = "demo.";
    static final int PASSWORD_MIN = 10, PASSWORD_MAX_BYTES = 72, NAME_MAX = 20, BIO_MAX = 100;
    // common values are refused whatever their length; compared in lower case
    private static final Set<String> COMMON = Set.of(
            "1234567890", "12345678901", "123456789012", "0123456789", "0987654321", "9876543210", "1111111111", "0000000000",
            "password", "password1", "password12", "password123", "passw0rd12", "qwertyuiop", "qwerty1234", "qwerty12345",
            "asdfghjkl1", "abcdefghij", "abcd123456", "iloveyou12", "admin12345", "welcome123", "letmein123", "changeme123");

    static boolean loginId(String value) {
        return value != null && LOGIN_ID.matcher(value).matches() && !value.startsWith(RESERVED_PREFIX);
    }

    static boolean password(String loginId, String value) {
        if (value == null || value.isBlank()) return false;
        if (value.codePointCount(0, value.length()) < PASSWORD_MIN) return false;
        if (value.getBytes(StandardCharsets.UTF_8).length > PASSWORD_MAX_BYTES) return false;
        String lower = value.toLowerCase(Locale.ROOT);
        if (loginId != null && lower.contains(loginId.toLowerCase(Locale.ROOT))) return false;
        if (COMMON.contains(lower)) return false;
        return value.codePoints().distinct().count() > 1; // one character repeated
    }

    /** Trimmed 1..20 code points without control characters, or null. */
    static String displayName(String value) {
        if (value == null) return null;
        String name = value.strip();
        int length = name.codePointCount(0, name.length());
        if (length < 1 || length > NAME_MAX || hasControl(name, false)) return null;
        return name;
    }

    /** Trimmed 0..100 code points; a bio is one line, so no control character at all (not even a line break). */
    static String bio(String value) {
        if (value == null) return null;
        String text = value.strip();
        if (text.codePointCount(0, text.length()) > BIO_MAX || hasControl(text, false)) return null;
        return text;
    }

    private static boolean hasControl(String text, boolean allowWhitespaceControls) {
        return text.codePoints().anyMatch(cp -> Character.isISOControl(cp) && !(allowWhitespaceControls && (cp == '\t' || cp == '\n')));
    }
}
