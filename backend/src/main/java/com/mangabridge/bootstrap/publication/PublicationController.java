package com.mangabridge.bootstrap.publication;

import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class PublicationController {
    private final PublicationService service;
    public PublicationController(PublicationService service) { this.service=service; }
    @PostMapping("/api/episodes/{id}/translations/{versionNo}/publish") public ResponseEntity<?> publish(
            @PathVariable String id,@PathVariable String versionNo,@RequestBody(required=false) byte[] body,
            Authentication auth,HttpServletRequest request) {
        requireNoBody(body,request);
        return ok(service.publishTranslation((CurrentUser)auth.getPrincipal(),id,versionNo));
    }
    @PostMapping("/api/episodes/{id}/publication/hold") public ResponseEntity<?> hold(
            @PathVariable String id,@RequestBody(required=false) byte[] body,Authentication auth,HttpServletRequest request) {
        requireNoBody(body,request);
        return ok(service.holdPublication((CurrentUser)auth.getPrincipal(),id));
    }
    @PostMapping("/api/episodes/{id}/publication/resume") public ResponseEntity<?> resume(
            @PathVariable String id,@RequestBody(required=false) byte[] body,Authentication auth,HttpServletRequest request) {
        requireNoBody(body,request);
        return ok(service.resumePublication((CurrentUser)auth.getPrincipal(),id));
    }
    private static void requireNoBody(byte[] body,HttpServletRequest request) {
        if(body!=null && body.length>0) throw PublicationFailure.invalid();
        if(request.getContentType()!=null) {
            try {
                var type=MediaType.parseMediaType(request.getContentType());
                if(!type.getType().equalsIgnoreCase("application") || !(type.getSubtype().equalsIgnoreCase("json")||type.getSubtype().endsWith("+json"))) throw PublicationFailure.invalid();
            } catch(IllegalArgumentException error) { throw PublicationFailure.invalid(); }
        }
    }
    @GetMapping("/api/episodes/{id}/publication") public ResponseEntity<?> publication(@PathVariable String id) { return ok(service.getPublication(id)); }
    @GetMapping("/api/public/episodes") public ResponseEntity<?> list(@RequestParam(required=false) String limit,@RequestParam(required=false) String offset) {
        return ok(service.listPublicEpisodes(limit==null?"50":limit,offset==null?"0":offset));
    }
    @GetMapping("/api/public/episodes/{id}") public ResponseEntity<?> detail(@PathVariable String id) { return ok(service.getPublicEpisode(id)); }
    @RequestMapping(value={"/api/public/episodes","/api/public/episodes/{id}"},method={RequestMethod.POST,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS})
    public ResponseEntity<?> unsupported() {
        return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","GET")
                .body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));
    }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
