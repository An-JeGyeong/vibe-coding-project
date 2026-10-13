package com.mangabridge.bootstrap.account;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mangabridge.bootstrap.auth.AuthModels.LoginResponse;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.AuthModels.User;
import com.mangabridge.bootstrap.auth.AuthService;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

/** Sign-up, profile and password of an account (CONTRACTS 32.2, 32.3). Only reader accounts are ever created here. */
@Service
public class AccountService {
    public record RegisterRequest(String loginId, String password, String displayName) {
        @Override public String toString() { return "RegisterRequest[redacted]"; }
    }
    public record ProfileRequest(String displayName, String bio) { }
    public record PasswordRequest(String currentPassword, String newPassword) {
        @Override public String toString() { return "PasswordRequest[redacted]"; }
    }

    private final AccountDao dao;
    private final AuthService auth;
    private final PasswordEncoder encoder;
    private final RegisterLimiter limiter;
    private final Clock clock;
    private final ObjectMapper mapper;
    private final TransactionTemplate tx;

    AccountService(AccountDao dao, AuthService auth, PasswordEncoder encoder, RegisterLimiter limiter, Clock clock, ObjectMapper mapper, PlatformTransactionManager manager) {
        this.dao = dao; this.auth = auth; this.encoder = encoder; this.limiter = limiter; this.clock = clock; this.mapper = StrictJson.of(mapper);
        this.tx = new TransactionTemplate(manager);
    }

    /** Every attempt is counted before the body is even read, so malformed and invalid requests use up the allowance too. */
    LoginResponse register(String rawBody, String address) {
        limiter.attempt(address);
        RegisterRequest request;
        try { request = rawBody == null ? null : mapper.readValue(rawBody, RegisterRequest.class); }
        catch (Exception malformed) { throw AccountFailure.invalid(); }
        if (request == null || !AccountRules.loginId(request.loginId()) || !AccountRules.password(request.loginId(), request.password())) throw AccountFailure.invalid();
        String name = AccountRules.displayName(request.displayName());
        if (name == null) throw AccountFailure.invalid();
        String hash = encoder.encode(request.password()); // outside the transaction: BCrypt is slow
        try {
            return tx.execute(status -> {
                long id = dao.insertReader(request.loginId(), name, hash);
                dao.insertProfile(id, clock.instant().truncatedTo(ChronoUnit.MICROS));
                return auth.issueSession(new User(Long.toString(id), name, Role.READER), "REGISTER");
            });
        } catch (DuplicateKeyException duplicate) {
            throw AccountFailure.taken();
        } catch (DataAccessException | TransactionException failure) {
            throw AccountFailure.unavailable();
        }
    }

    Map<String, Object> profile(long accountId) {
        try {
            var row = dao.row(accountId);
            if (row == null) throw AccountFailure.missing();
            var body = new LinkedHashMap<String, Object>();
            body.put("loginId", row.loginId()); body.put("displayName", row.displayName()); body.put("bio", dao.bio(accountId)); body.put("role", row.role());
            return body;
        } catch (DataAccessException failure) {
            throw AccountFailure.unavailable();
        }
    }

    Map<String, Object> updateProfile(long accountId, ProfileRequest request) {
        String name = request == null ? null : AccountRules.displayName(request.displayName());
        String bio = request == null ? null : AccountRules.bio(request.bio());
        if (name == null || bio == null) throw AccountFailure.invalid();
        try {
            return tx.execute(status -> {
                if (dao.row(accountId) == null) throw AccountFailure.missing();
                dao.updateName(accountId, name);
                dao.saveBio(accountId, bio, clock.instant().truncatedTo(ChronoUnit.MICROS));
                return Map.<String, Object>of("displayName", name, "bio", bio);
            });
        } catch (DataAccessException | TransactionException failure) {
            throw AccountFailure.unavailable();
        }
    }

    void changePassword(long accountId, String currentToken, PasswordRequest request) {
        if (request == null || request.currentPassword() == null || request.currentPassword().isEmpty()) throw AccountFailure.invalid();
        var row = lookup(accountId);
        if (!AccountRules.password(row.loginId(), request.newPassword())) throw AccountFailure.invalid();
        if (!encoder.matches(request.currentPassword(), row.passwordHash())) throw AccountFailure.wrongCurrentPassword();
        String hash = encoder.encode(request.newPassword());
        try {
            tx.executeWithoutResult(status -> {
                dao.updatePassword(accountId, hash);
                auth.revokeOtherTokens(accountId, currentToken);
            });
        } catch (DataAccessException | TransactionException failure) {
            throw AccountFailure.unavailable();
        }
    }

    private AccountDao.Row lookup(long accountId) {
        try {
            var row = dao.row(accountId);
            if (row == null) throw AccountFailure.missing();
            return row;
        } catch (DataAccessException failure) {
            throw AccountFailure.unavailable();
        }
    }
}
