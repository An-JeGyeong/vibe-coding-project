package com.mangabridge.bootstrap.account;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** Fixed bodies for the account endpoints: the code and a fixed sentence, never the input or the reason. */
@RestControllerAdvice(assignableTypes = {AccountController.class})
class AccountErrors {
    static Map<String, Object> body(String code) {
        String message = switch (code) {
            case "INVALID_REQUEST" -> "요청 형식을 확인하세요.";
            case "INVALID_CURRENT_PASSWORD" -> "현재 비밀번호가 올바르지 않습니다.";
            case "LOGIN_ID_TAKEN" -> "이미 사용 중인 아이디입니다.";
            case "REGISTER_RATE_LIMITED" -> "가입 요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.";
            case "NOT_FOUND" -> "요청한 항목을 찾을 수 없습니다.";
            case "SERVICE_UNAVAILABLE" -> "서비스를 사용할 수 없습니다. 다시 시도하세요.";
            default -> "요청을 처리하지 못했습니다.";
        };
        return Map.of("error", Map.of("code", code, "message", message));
    }

    @ExceptionHandler(AccountFailure.class)
    ResponseEntity<Map<String, Object>> failure(AccountFailure failure) {
        var response = ResponseEntity.status(failure.status).header("Cache-Control", "no-store");
        if (failure.retryAfterSeconds != null) response = response.header("Retry-After", Long.toString(failure.retryAfterSeconds));
        return response.body(body(failure.code));
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, HttpMediaTypeNotSupportedException.class})
    ResponseEntity<Map<String, Object>> invalid() {
        return ResponseEntity.status(400).header("Cache-Control", "no-store").body(body("INVALID_REQUEST"));
    }
}
