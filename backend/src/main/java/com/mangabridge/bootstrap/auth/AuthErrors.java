package com.mangabridge.bootstrap.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import com.mangabridge.bootstrap.episode.EpisodeController;
import com.mangabridge.bootstrap.episode.EpisodeFailure;
import com.mangabridge.bootstrap.assignment.AssignmentController;
import com.mangabridge.bootstrap.assignment.AssignmentFailure;
import java.util.Map;
import org.springframework.http.converter.HttpMessageNotReadableException;
import static com.mangabridge.bootstrap.auth.AuthModels.*;

@RestControllerAdvice(assignableTypes={AuthController.class,EpisodeController.class,AssignmentController.class})
public class AuthErrors {
    static ErrorResponse body(String code) {
        String message=switch(code) {
            case "INVALID_REQUEST" -> "요청 형식을 확인하세요.";
            case "INVALID_CREDENTIALS" -> "로그인 정보를 확인하세요.";
            case "AUTH_REQUIRED" -> "로그인이 필요합니다.";
            case "FORBIDDEN" -> "접근 권한이 없습니다.";
            case "LOGIN_RATE_LIMITED" -> "잠시 후 다시 시도하세요.";
            case "AUTH_UNAVAILABLE" -> "인증 서비스를 사용할 수 없습니다. 다시 시도하세요.";
            case "NOT_FOUND" -> "요청한 회차 또는 원문 버전을 찾을 수 없습니다.";
            case "VERSION_CONFLICT" -> "원문이 변경되었습니다. 최신 버전을 확인하세요.";
            case "SERVICE_UNAVAILABLE" -> "서비스를 사용할 수 없습니다. 다시 시도하세요.";
            default -> "요청을 처리하지 못했습니다.";
        };
        return new ErrorResponse(new ErrorDetail(code,message));
    }
    @ExceptionHandler(AuthFailure.class) ResponseEntity<ErrorResponse> failure(AuthFailure e) {
        var response=ResponseEntity.status(e.status).header("Cache-Control","no-store");
        if(e.retryAfter>0) response.header("Retry-After",Long.toString(e.retryAfter));
        return response.body(body(e.code));
    }
    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    ResponseEntity<ErrorResponse> invalid() { return failure(AuthFailure.invalid()); }
    @ExceptionHandler(EpisodeFailure.class) ResponseEntity<?> episodeFailure(EpisodeFailure failure) {
        ErrorResponse response=body(failure.code);
        Object payload=failure.latestVersion==null?response:Map.of("error",Map.of(
                "code",response.error().code(),"message",response.error().message(),"latestVersion",failure.latestVersion));
        return ResponseEntity.status(failure.status).header("Cache-Control","no-store").body(payload);
    }
    @ExceptionHandler(AssignmentFailure.class) ResponseEntity<ErrorResponse> assignmentFailure(AssignmentFailure failure) {
        return ResponseEntity.status(failure.status).header("Cache-Control","no-store").body(body(failure.code));
    }
    @ExceptionHandler(Exception.class) ResponseEntity<ErrorResponse> internal() {
        return ResponseEntity.internalServerError().header("Cache-Control","no-store").body(body("INTERNAL_ERROR"));
    }
    static void write(HttpServletResponse response,ObjectMapper mapper,AuthFailure failure) throws IOException {
        response.setStatus(failure.status); response.setContentType("application/json"); response.setCharacterEncoding("UTF-8");
        response.setHeader("Cache-Control","no-store");
        mapper.writeValue(response.getOutputStream(),body(failure.code));
    }
}
