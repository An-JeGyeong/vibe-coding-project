package com.mangabridge.bootstrap.history;

import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;

@RestController
public class HistoryController {
    private final HistoryService service;
    public HistoryController(HistoryService service) { this.service=service; }
    @GetMapping("/api/history") public ResponseEntity<HistoryModels.History> history(@RequestParam MultiValueMap<String,String> query) {
        return ResponseEntity.ok().header("Cache-Control","no-store").body(service.listHistory(query));
    }
}
