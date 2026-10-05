package com.mangabridge.bootstrap.health;

import java.time.Instant;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {
    private final HealthService health;
    public HealthController(HealthService health) { this.health = health; }

    @GetMapping(value = "/api/health", produces = "application/json")
    public ResponseEntity<HealthResponse> health() {
        boolean available = health.databaseAvailable();
        return ResponseEntity.status(available ? 200 : 503).cacheControl(CacheControl.noStore())
                .body(new HealthResponse("UP", available ? "UP" : "DOWN", Instant.now().toString()));
    }

    public record HealthResponse(String status, String db, String time) { }
}
