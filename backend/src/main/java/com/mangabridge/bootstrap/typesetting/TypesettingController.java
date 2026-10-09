package com.mangabridge.bootstrap.typesetting;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
@RestController public class TypesettingController {
 private final TypesettingService service;public TypesettingController(TypesettingService service){this.service=service;}
 @GetMapping("/api/my/episodes/{id}/typesetting")public ResponseEntity<?> list(@PathVariable String id,Authentication auth){return ok(service.list((CurrentUser)auth.getPrincipal(),id));}
 @GetMapping("/api/my/episodes/{id}/typesetting/{versionNo}")public ResponseEntity<?> detail(@PathVariable String id,@PathVariable String versionNo,Authentication auth){return ok(service.detail((CurrentUser)auth.getPrincipal(),id,versionNo));}
 private static ResponseEntity<?> ok(Object body){return ResponseEntity.ok().header("Cache-Control","no-store").body(body);}
}
