package com.mangabridge.bootstrap.review;

import static com.mangabridge.bootstrap.review.ReviewModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class ReviewController {
    private final ReviewService service;
    public ReviewController(ReviewService service) { this.service=service; }
    @GetMapping("/api/my/reviews") public ResponseEntity<?> pending(Authentication auth,
            @RequestParam(required=false) String limit,@RequestParam(required=false) String offset) {
        return ok(service.listPendingReviews(user(auth),limit==null?"50":limit,offset==null?"0":offset));
    }
    @GetMapping("/api/my/episodes/{id}/reviews") public ResponseEntity<?> list(@PathVariable String id,Authentication auth) {
        return ok(service.listEpisodeReviews(user(auth),id));
    }
    @GetMapping("/api/my/episodes/{id}/reviews/{versionNo}") public ResponseEntity<?> detail(@PathVariable String id,@PathVariable String versionNo,Authentication auth) {
        return ok(service.getReview(user(auth),id,versionNo));
    }
    @PostMapping("/api/my/episodes/{id}/reviews/{versionNo}/approve") public ResponseEntity<?> approve(@PathVariable String id,@PathVariable String versionNo,
            @RequestBody(required=false) byte[] body,Authentication auth,HttpServletRequest request) {
        if(body!=null && body.length>0) throw ReviewFailure.invalid();
        if(request.getContentType()!=null) {
            try {
                var type=MediaType.parseMediaType(request.getContentType());
                if(!type.getType().equalsIgnoreCase("application") || !(type.getSubtype().equalsIgnoreCase("json")||type.getSubtype().endsWith("+json"))) throw ReviewFailure.invalid();
            } catch(IllegalArgumentException failure) { throw ReviewFailure.invalid(); }
        }
        return ok(service.approveTranslation(user(auth),id,versionNo));
    }
    @PostMapping("/api/my/episodes/{id}/reviews/{versionNo}/reject") public ResponseEntity<?> reject(@PathVariable String id,@PathVariable String versionNo,
            @RequestBody RejectRequest body,Authentication auth) {
        return ok(service.rejectTranslation(user(auth),id,versionNo,body));
    }
    @GetMapping("/api/episodes/{id}/translations") public ResponseEntity<?> operatorList(@PathVariable String id) { return ok(service.listTranslationsForOperator(id)); }
    @GetMapping("/api/episodes/{id}/translations/{versionNo}") public ResponseEntity<?> operatorDetail(@PathVariable String id,@PathVariable String versionNo) {
        return ok(service.getTranslationForOperator(id,versionNo));
    }
    private static CurrentUser user(Authentication auth) { return (CurrentUser)auth.getPrincipal(); }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
