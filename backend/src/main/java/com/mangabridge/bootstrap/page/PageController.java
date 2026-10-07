package com.mangabridge.bootstrap.page;

import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
public class PageController {
    private final PageService service;
    public PageController(PageService service) { this.service=service; }
    @PutMapping("/api/episodes/{id}/pages/{pageNo}/image")
    public ResponseEntity<PageModels.Metadata> save(@PathVariable String id,@PathVariable String pageNo,Authentication auth,HttpServletRequest request) {
        PageService.path(id,false);PageService.path(pageNo,true);
        byte[] bytes=readBounded(request);var result=service.savePageImage(user(auth),id,pageNo,request.getContentType(),bytes);
        return ResponseEntity.status(result.status()).header("Cache-Control","no-store").body(result.metadata());
    }
    static byte[] readBounded(HttpServletRequest request) {
        String type=request.getContentType();
        if(!java.util.Set.of("image/png","image/jpeg","image/webp").contains(type==null?"":type)||request.getContentLengthLong()>PageService.MAX_BYTES) throw PageFailure.invalid();
        try {
            byte[] bytes=request.getInputStream().readNBytes(PageService.MAX_BYTES+1);
            if(bytes.length==0||bytes.length>PageService.MAX_BYTES) throw PageFailure.invalid();return bytes;
        } catch(IOException failure) {throw PageFailure.invalid();}
    }
    @GetMapping("/api/episodes/{id}/pages") public ResponseEntity<PageModels.Pages> list(@PathVariable String id,Authentication auth) { return ok(service.listPageImages(user(auth),id,false)); }
    @GetMapping("/api/my/episodes/{id}/pages") public ResponseEntity<PageModels.Pages> assignedList(@PathVariable String id,Authentication auth) { return ok(service.listPageImages(user(auth),id,true)); }
    @GetMapping("/api/episodes/{id}/pages/{pageNo}/image") public ResponseEntity<byte[]> image(@PathVariable String id,@PathVariable String pageNo,Authentication auth) { return imageResponse(service.getPageImage(user(auth),id,pageNo,false)); }
    @GetMapping("/api/my/episodes/{id}/pages/{pageNo}/image") public ResponseEntity<byte[]> assignedImage(@PathVariable String id,@PathVariable String pageNo,Authentication auth) { return imageResponse(service.getPageImage(user(auth),id,pageNo,true)); }
    private static ResponseEntity<byte[]> imageResponse(PageModels.Image image) {return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").contentType(MediaType.parseMediaType(image.contentType())).body(image.bytes());}
    private static <T> ResponseEntity<T> ok(T body) {return ResponseEntity.ok().header("Cache-Control","no-store").body(body);}
    private static CurrentUser user(Authentication auth) {return (CurrentUser)auth.getPrincipal();}
}
