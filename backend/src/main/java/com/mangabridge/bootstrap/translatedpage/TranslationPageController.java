package com.mangabridge.bootstrap.translatedpage;

import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.page.PageModels;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.util.Map;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class TranslationPageController {
    private final TranslationPageService service;
    public TranslationPageController(TranslationPageService service) {this.service=service;}
    @PutMapping("/api/my/episodes/{id}/translations/{versionNo}/page-images/{pageNo}")
    public ResponseEntity<?> save(@PathVariable String id,@PathVariable String versionNo,@PathVariable String pageNo,Authentication auth,HttpServletRequest request) {
        TranslationPageService.path(id,18);TranslationPageService.path(versionNo,9);TranslationPageService.path(pageNo,4);
        var saved=service.saveTranslationPageImage(user(auth),id,versionNo,pageNo,request.getContentType(),readBounded(request));
        return ResponseEntity.status(saved.status()).header("Cache-Control","no-store").body(saved.metadata());
    }
    static byte[] readBounded(HttpServletRequest request) {
        if(!java.util.Set.of("image/png","image/jpeg","image/webp").contains(request.getContentType()==null?"":request.getContentType())||request.getContentLengthLong()>TranslationPageService.MAX_BYTES) throw TranslationPageFailure.invalid();
        try {byte[] bytes=request.getInputStream().readNBytes(TranslationPageService.MAX_BYTES+1);if(bytes.length==0||bytes.length>TranslationPageService.MAX_BYTES) throw TranslationPageFailure.invalid();return bytes;}catch(IOException failure){throw TranslationPageFailure.invalid();}
    }
    @GetMapping("/api/my/episodes/{id}/translations/{versionNo}/page-images")
    public ResponseEntity<?> assignedList(@PathVariable String id,@PathVariable String versionNo,Authentication auth){return ok(service.list(user(auth),id,versionNo,false));}
    @GetMapping("/api/my/episodes/{id}/translations/{versionNo}/page-images/{pageNo}")
    public ResponseEntity<byte[]> assignedImage(@PathVariable String id,@PathVariable String versionNo,@PathVariable String pageNo,Authentication auth){return image(service.image(user(auth),id,versionNo,pageNo,false));}
    @GetMapping("/api/episodes/{id}/translations/{versionNo}/page-images")
    public ResponseEntity<?> list(@PathVariable String id,@PathVariable String versionNo,Authentication auth){return ok(service.list(user(auth),id,versionNo,true));}
    @GetMapping("/api/episodes/{id}/translations/{versionNo}/page-images/{pageNo}")
    public ResponseEntity<byte[]> get(@PathVariable String id,@PathVariable String versionNo,@PathVariable String pageNo,Authentication auth){return image(service.image(user(auth),id,versionNo,pageNo,true));}
    @GetMapping("/api/public/episodes/{id}/pages") public ResponseEntity<?> publicList(@PathVariable String id){return ok(service.publicList(id));}
    @GetMapping("/api/public/episodes/{id}/pages/{pageNo}/image") public ResponseEntity<byte[]> publicImage(@PathVariable String id,@PathVariable String pageNo){return image(service.publicImage(id,pageNo));}
    @RequestMapping(value={"/api/public/episodes/{id}/pages","/api/public/episodes/{id}/pages/{pageNo}/image"},method={RequestMethod.POST,RequestMethod.PUT,RequestMethod.PATCH,RequestMethod.DELETE,RequestMethod.HEAD,RequestMethod.OPTIONS})
    public ResponseEntity<?> unsupported(){return ResponseEntity.status(405).header("Cache-Control","no-store").header("Allow","GET").body(Map.of("error",Map.of("code","METHOD_NOT_ALLOWED","message","허용되지 않은 요청 방식입니다.")));}
    private static ResponseEntity<byte[]> image(PageModels.Image image){return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.contentType())).body(image.bytes());}
    private static <T> ResponseEntity<T> ok(T body){return ResponseEntity.ok().header("Cache-Control","no-store").body(body);}
    private static CurrentUser user(Authentication auth){return (CurrentUser)auth.getPrincipal();}
}
