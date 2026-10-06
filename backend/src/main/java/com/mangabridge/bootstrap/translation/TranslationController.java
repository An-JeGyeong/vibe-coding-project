package com.mangabridge.bootstrap.translation;

import static com.mangabridge.bootstrap.translation.TranslationModels.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/my/episodes/{id}/translations")
public class TranslationController {
    private final TranslationService service;
    public TranslationController(TranslationService service) { this.service=service; }
    @GetMapping public ResponseEntity<Versions> list(@PathVariable String id,Authentication auth) {
        return ok(service.listTranslations(user(auth),id));
    }
    @PostMapping public ResponseEntity<Created> create(@PathVariable String id,@RequestBody(required=false) JsonNode body,
            Authentication auth,HttpServletRequest request) {
        if(body!=null) throw TranslationFailure.invalid();
        if(request.getContentType()!=null) {
            try {
                var type=MediaType.parseMediaType(request.getContentType());
                if(!type.getType().equalsIgnoreCase("application") || !(type.getSubtype().equalsIgnoreCase("json") || type.getSubtype().endsWith("+json")))
                    throw TranslationFailure.invalid();
            } catch(IllegalArgumentException invalidType) { throw TranslationFailure.invalid(); }
        }
        return ResponseEntity.status(201).header("Cache-Control","no-store").body(service.createTranslation(user(auth),id));
    }
    @GetMapping("/{versionNo}") public ResponseEntity<Detail> detail(@PathVariable String id,@PathVariable String versionNo,Authentication auth) {
        return ok(service.getTranslation(user(auth),id,versionNo));
    }
    @PutMapping("/{versionNo}") public ResponseEntity<Saved> save(@PathVariable String id,@PathVariable String versionNo,
            @RequestBody SaveRequest request,Authentication auth) {
        return ok(service.saveTranslationDraft(user(auth),id,versionNo,request));
    }
    @PostMapping("/{versionNo}/submit") public ResponseEntity<Submitted> submit(@PathVariable String id,@PathVariable String versionNo,
            @RequestBody SubmitRequest request,Authentication auth) {
        return ok(service.submitTranslation(user(auth),id,versionNo,request));
    }
    private static CurrentUser user(Authentication auth) { return (CurrentUser)auth.getPrincipal(); }
    private static <T> ResponseEntity<T> ok(T body) { return ResponseEntity.ok().header("Cache-Control","no-store").body(body); }
}
