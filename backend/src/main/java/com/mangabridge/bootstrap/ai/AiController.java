package com.mangabridge.bootstrap.ai;

import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/my/episodes/{id}/translations/{versionNo}/ai-draft")
public class AiController {
    private final AiService service;
    public AiController(AiService service) { this.service=service; }
    @PostMapping public ResponseEntity<AiModels.Result> draft(@PathVariable String id,@PathVariable String versionNo,
            @RequestBody(required=false) byte[] body,Authentication auth,HttpServletRequest request) {
        if(body!=null&&body.length>0) throw AiFailure.invalid();
        if(request.getContentType()!=null) {
            try {
                var type=MediaType.parseMediaType(request.getContentType());
                if(!type.getType().equalsIgnoreCase("application")||!(type.getSubtype().equalsIgnoreCase("json")||type.getSubtype().endsWith("+json"))) throw AiFailure.invalid();
            } catch(IllegalArgumentException invalid) { throw AiFailure.invalid(); }
        }
        return ResponseEntity.ok().header("Cache-Control","no-store").body(service.requestAiDraft((CurrentUser)auth.getPrincipal(),id,versionNo));
    }
}
