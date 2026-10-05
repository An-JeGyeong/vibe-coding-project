package com.mangabridge.bootstrap.episode;

import static com.mangabridge.bootstrap.episode.EpisodeModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/episodes")
public class EpisodeController {
    private final EpisodeService service;
    public EpisodeController(EpisodeService service) { this.service=service; }
    @PostMapping public ResponseEntity<Created> create(@RequestBody CreateRequest request,Authentication auth) {
        return ResponseEntity.status(201).header("Cache-Control","no-store").body(service.createEpisode(request,(CurrentUser)auth.getPrincipal()));
    }
    @GetMapping public ResponseEntity<Episodes> list(@RequestParam(defaultValue="50") String limit,@RequestParam(defaultValue="0") String offset) {
        return ok(service.listEpisodes(limit,offset));
    }
    @GetMapping("/{id}") public ResponseEntity<Detail> detail(@PathVariable String id) { return ok(service.getEpisode(id)); }
    @PutMapping("/{id}/source") public ResponseEntity<?> save(@PathVariable String id,@RequestBody SourceRequest request,Authentication auth) {
        var response=service.saveSourceVersion(id,request,(CurrentUser)auth.getPrincipal());
        return ResponseEntity.status(Boolean.TRUE.equals(response.get("changed"))?201:200).header("Cache-Control","no-store").body(response);
    }
    @GetMapping("/{id}/source/versions") public ResponseEntity<Versions> versions(@PathVariable String id) { return ok(service.listSourceVersions(id)); }
    @GetMapping("/{id}/source/versions/{version}") public ResponseEntity<Source> version(@PathVariable String id,@PathVariable String version) {
        return ok(service.getSourceVersion(id,version));
    }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
