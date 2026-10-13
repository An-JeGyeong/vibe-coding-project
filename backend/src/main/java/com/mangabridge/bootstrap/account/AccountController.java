package com.mangabridge.bootstrap.account;

import static com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.auth.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class AccountController {
    private final AccountService service;
    AccountController(AccountService service) { this.service = service; }

    @PostMapping("/api/auth/register")
    ResponseEntity<?> register(@RequestBody(required = false) String body, HttpServletRequest request) {
        return ResponseEntity.status(201).header("Cache-Control", "no-store").body(service.register(body, address(request)));
    }
    @GetMapping("/api/me/profile")
    ResponseEntity<Map<String, Object>> profile(Authentication authentication) {
        return ok(service.profile(accountId(authentication)));
    }
    @PatchMapping("/api/me/profile")
    ResponseEntity<Map<String, Object>> updateProfile(Authentication authentication, @RequestBody(required = false) AccountService.ProfileRequest body) {
        return ok(service.updateProfile(accountId(authentication), body));
    }
    @PostMapping("/api/me/password")
    ResponseEntity<Void> password(Authentication authentication, HttpServletRequest request, @RequestBody(required = false) AccountService.PasswordRequest body) {
        service.changePassword(accountId(authentication), AuthService.bearer(request.getHeader("Authorization"), false), body);
        return ResponseEntity.noContent().header("Cache-Control", "no-store").build();
    }

    static long accountId(Authentication authentication) {
        return Long.parseLong(((CurrentUser) authentication.getPrincipal()).user().id());
    }
    static <T> ResponseEntity<T> ok(T body) {
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(body);
    }
    /** The last X-Forwarded-For value is the address the platform's proxy saw (earlier values can be forged); otherwise the connection address. */
    static String address(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            String[] parts = forwarded.split(",");
            String last = parts[parts.length - 1].trim();
            if (!last.isEmpty() && last.length() <= 64) return last;
        }
        return request.getRemoteAddr();
    }
}
