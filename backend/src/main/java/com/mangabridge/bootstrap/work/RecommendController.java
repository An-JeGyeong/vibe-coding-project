package com.mangabridge.bootstrap.work;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
@RestController
public class RecommendController {
 private final RecommendService service;public RecommendController(RecommendService service){this.service=service;}
 @PostMapping(value="/api/public/works/{id}/recommend") public ResponseEntity<?> recommend(@PathVariable String id,@RequestBody RecommendService.Request body){return WorkController.ok(service.recommend(id,body,true));}
 @PostMapping(value="/api/public/works/{id}/unrecommend") public ResponseEntity<?> unrecommend(@PathVariable String id,@RequestBody RecommendService.Request body){return WorkController.ok(service.recommend(id,body,false));}
 @RequestMapping(value={"/api/public/works/{id}/recommend","/api/public/works/{id}/unrecommend"},method={RequestMethod.GET,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS}) public ResponseEntity<?> unsupported(){return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","POST").body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));}
}
