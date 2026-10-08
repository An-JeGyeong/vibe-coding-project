package com.mangabridge.bootstrap.work;
import static com.mangabridge.bootstrap.work.WorkModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.page.PageModels.Image;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.*;
@RestController
public class WorkController {
 private final WorkService service;public WorkController(WorkService service){this.service=service;}
 @PostMapping("/api/works") public ResponseEntity<?> create(@RequestBody Create request,Authentication auth){return ResponseEntity.status(201).header("Cache-Control","no-store").body(service.createWork(request,user(auth)));}
 @GetMapping("/api/works") public ResponseEntity<?> list(@RequestParam MultiValueMap<String,String> query){return ok(service.listWorks(query));}
 @GetMapping("/api/works/{id}") public ResponseEntity<?> get(@PathVariable String id){return ok(service.getWork(id));}
 @PutMapping("/api/works/{id}") public ResponseEntity<?> update(@PathVariable String id,@RequestBody Update request){return ok(service.updateWork(id,request));}
 @PutMapping("/api/works/{id}/cover") public ResponseEntity<?> cover(@PathVariable String id,HttpServletRequest request,Authentication auth){WorkService.path(id);var result=service.saveWorkCover(id,request.getContentType(),readBounded(request),user(auth));return ResponseEntity.status(result.status()).header("Cache-Control","no-store").body(result.metadata());}
 @GetMapping("/api/works/{id}/cover") public ResponseEntity<byte[]> cover(@PathVariable String id){return image(service.getWorkCover(id));}
 @PutMapping("/api/episodes/{id}/work") public ResponseEntity<?> link(@PathVariable String id,@RequestBody Link request){return ok(service.assignEpisodeWork(id,request));}
 @DeleteMapping("/api/episodes/{id}/work") public ResponseEntity<?> unlink(@PathVariable String id){service.unassign(id);return ResponseEntity.noContent().header("Cache-Control","no-store").build();}
 @GetMapping("/api/episodes/{id}/work") public ResponseEntity<?> link(@PathVariable String id){return ok(service.getEpisodeWork(id));}
 static byte[] readBounded(HttpServletRequest request){if(!java.util.Set.of("image/png","image/jpeg","image/webp").contains(request.getContentType()==null?"":request.getContentType())||request.getContentLengthLong()>WorkService.MAX_BYTES)throw WorkFailure.invalid();try{byte[] bytes=request.getInputStream().readNBytes(WorkService.MAX_BYTES+1);if(bytes.length==0||bytes.length>WorkService.MAX_BYTES)throw WorkFailure.invalid();return bytes;}catch(IOException failure){throw WorkFailure.invalid();}}
 static ResponseEntity<byte[]> image(Image image){return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.contentType())).body(image.bytes());}
 static <T>ResponseEntity<T> ok(T body){return ResponseEntity.ok().header("Cache-Control","no-store").body(body);}
 private static CurrentUser user(Authentication auth){return (CurrentUser)auth.getPrincipal();}
}
