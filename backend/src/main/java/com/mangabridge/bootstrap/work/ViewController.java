package com.mangabridge.bootstrap.work;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
@RestController
public class ViewController {
 private final ViewService service;public ViewController(ViewService service){this.service=service;}
 @PostMapping("/api/public/episodes/{id}/views") public ResponseEntity<?> record(@PathVariable String id){service.recordView(id);return ResponseEntity.noContent().header("Cache-Control","no-store").build();}
 @RequestMapping(value="/api/public/episodes/{id}/views",method={RequestMethod.GET,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS})
 public ResponseEntity<?> unsupported(){return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","POST").body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));}
}
