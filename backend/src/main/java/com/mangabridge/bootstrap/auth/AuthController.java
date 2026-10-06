package com.mangabridge.bootstrap.auth;

import static com.mangabridge.bootstrap.auth.AuthModels.*;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final AuthService service;
    public AuthController(AuthService service) { this.service=service; }
    @PostMapping("/login") public ResponseEntity<LoginResponse> login(@RequestBody LoginRequest request) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body(service.loginDemoAccount(request));
    }
    @GetMapping("/me") public ResponseEntity<CurrentUser> me(Authentication authentication) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body((CurrentUser)authentication.getPrincipal());
    }
    @PostMapping("/logout") public ResponseEntity<Void> logout(HttpServletRequest request) {
        service.logout(AuthService.bearer(request.getHeader("Authorization"),true));
        return ResponseEntity.noContent().header("Cache-Control","no-store").build();
    }
}
