package com.mangabridge.bootstrap.work;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
@RestController
public class RankingController {
 private final RankingService service;public RankingController(RankingService service){this.service=service;}
 @GetMapping("/api/public/rankings") public ResponseEntity<?> list(@RequestParam MultiValueMap<String,String> query){return WorkController.ok(service.rankings(query));}
 @RequestMapping(value="/api/public/rankings",method={RequestMethod.POST,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS}) public ResponseEntity<?> unsupported(){return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","GET").body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));}
}
