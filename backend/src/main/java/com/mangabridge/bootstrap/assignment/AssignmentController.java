package com.mangabridge.bootstrap.assignment;

import static com.mangabridge.bootstrap.assignment.AssignmentModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class AssignmentController {
    private final AssignmentService service;
    public AssignmentController(AssignmentService service) { this.service=service; }
    @GetMapping("/api/assignable-accounts") public ResponseEntity<Candidates> candidates(@RequestParam(required=false) String role) {
        return ok(service.listAssignableAccounts(role));
    }
    @GetMapping("/api/episodes/{id}/assignments") public ResponseEntity<Assignments> assignments(@PathVariable String id) {
        return ok(service.getAssignments(id));
    }
    @PutMapping("/api/episodes/{id}/assignments/{role}") public ResponseEntity<Result> assign(
            @PathVariable String id,@PathVariable String role,@RequestBody SetRequest request,Authentication auth) {
        var result=service.setAssignment(id,role,request,(CurrentUser)auth.getPrincipal());
        return ResponseEntity.status(result.status()).header("Cache-Control","no-store").body(result.body());
    }
    @GetMapping("/api/my/episodes") public ResponseEntity<Episodes> mine(Authentication auth,
            @RequestParam(defaultValue="50") String limit,@RequestParam(defaultValue="0") String offset) {
        return ok(service.listMyEpisodes((CurrentUser)auth.getPrincipal(),limit,offset));
    }
    @GetMapping("/api/my/episodes/{id}") public ResponseEntity<Detail> detail(Authentication auth,@PathVariable String id) {
        return ok(service.getMyEpisode((CurrentUser)auth.getPrincipal(),id));
    }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
