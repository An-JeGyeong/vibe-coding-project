package com.mangabridge.bootstrap.work;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
@RestController
public class CatalogController {
 private final CatalogService service;public CatalogController(CatalogService service){this.service=service;}
 @GetMapping("/api/public/home") public ResponseEntity<?> home(){return WorkController.ok(service.home());}
 @GetMapping("/api/public/works") public ResponseEntity<?> list(@RequestParam MultiValueMap<String,String> query){return WorkController.ok(service.list(query));}
 @GetMapping("/api/public/works/{id}") public ResponseEntity<?> detail(@PathVariable String id){return WorkController.ok(service.detail(id));}
 @GetMapping("/api/public/works/{id}/cover") public ResponseEntity<byte[]> cover(@PathVariable String id){return WorkController.image(service.cover(id));}
 @GetMapping("/api/public/episodes/{id}/work") public ResponseEntity<?> episodeWork(@PathVariable String id){return WorkController.ok(service.episodeWork(id));}
 @RequestMapping(value={"/api/public/home","/api/public/works","/api/public/works/{id}","/api/public/works/{id}/cover","/api/public/episodes/{id}/work"},method={RequestMethod.POST,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS})
 public ResponseEntity<?> unsupported(){return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","GET").body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));}
}
