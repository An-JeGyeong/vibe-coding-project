package com.mangabridge.bootstrap.account;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

/** CONTRACTS 32.4: the library, the recent episodes and the recommendations of the signed-in account. */
@RestController
public class MeController {
    private final MeService service;
    private final com.mangabridge.bootstrap.work.RecommendService votes;
    MeController(MeService service, com.mangabridge.bootstrap.work.RecommendService votes) { this.service = service; this.votes = votes; }

    private static long account(Authentication authentication) { return AccountController.accountId(authentication); }
    private static ResponseEntity<Void> noContent() { return ResponseEntity.noContent().header("Cache-Control", "no-store").build(); }

    @GetMapping("/api/me/library")
    ResponseEntity<Map<String, Object>> library(Authentication authentication) {
        return AccountController.ok(service.library(account(authentication)));
    }
    @PutMapping("/api/me/library/{workId}")
    ResponseEntity<Void> add(Authentication authentication, @PathVariable String workId) {
        service.addToLibrary(account(authentication), workId);
        return noContent();
    }
    @DeleteMapping("/api/me/library/{workId}")
    ResponseEntity<Void> remove(Authentication authentication, @PathVariable String workId) {
        service.removeFromLibrary(account(authentication), workId);
        return noContent();
    }
    @PostMapping("/api/me/library/merge")
    ResponseEntity<Map<String, Object>> mergeLibrary(Authentication authentication, @RequestBody(required = false) String body) {
        return AccountController.ok(service.mergeLibrary(account(authentication), body));
    }

    @GetMapping("/api/me/recent")
    ResponseEntity<Map<String, Object>> recent(Authentication authentication) {
        return AccountController.ok(service.recent(account(authentication)));
    }
    @PutMapping("/api/me/recent/{episodeId}")
    ResponseEntity<Void> touch(Authentication authentication, @PathVariable String episodeId) {
        service.touchRecent(account(authentication), episodeId);
        return noContent();
    }
    @DeleteMapping("/api/me/recent")
    ResponseEntity<Void> clear(Authentication authentication) {
        service.clearRecent(account(authentication));
        return noContent();
    }
    @PostMapping("/api/me/recent/merge")
    ResponseEntity<Map<String, Object>> mergeRecent(Authentication authentication, @RequestBody(required = false) String body) {
        return AccountController.ok(service.mergeRecent(account(authentication), body));
    }

    @PostMapping("/api/me/works/{workId}/recommend")
    ResponseEntity<Map<String, Object>> recommend(Authentication authentication, @PathVariable String workId) {
        return AccountController.ok(votes.recommend(workId, null, true, account(authentication)));
    }
    @PostMapping("/api/me/works/{workId}/unrecommend")
    ResponseEntity<Map<String, Object>> unrecommend(Authentication authentication, @PathVariable String workId) {
        return AccountController.ok(votes.recommend(workId, null, false, account(authentication)));
    }
    @GetMapping("/api/me/recommendations")
    ResponseEntity<Map<String, Object>> recommendations(Authentication authentication) {
        return AccountController.ok(service.recommendations(account(authentication)));
    }
}
