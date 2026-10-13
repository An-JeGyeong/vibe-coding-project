package com.mangabridge.bootstrap.auth;

import static com.mangabridge.bootstrap.auth.AuthModels.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import org.springframework.dao.DataAccessException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

@Service
public class AuthService {
    private final AuthDao dao;
    private final PasswordEncoder encoder;
    private final Clock clock;
    private final long ttl;
    private final TransactionTemplate tx;
    private final SecureRandom random = new SecureRandom();
    private final String dummyHash;
    public AuthService(AuthDao dao, PasswordEncoder encoder, Clock clock, long authTokenTtl, PlatformTransactionManager manager) {
        this.dao=dao; this.encoder=encoder; this.clock=clock; this.ttl=authTokenTtl;
        this.tx=new TransactionTemplate(manager);
        this.dummyHash=encoder.encode(Base64.getEncoder().encodeToString(random.generateSeed(32)));
    }
    public LoginResponse loginDemoAccount(LoginRequest request) {
        validate(request);
        try {
            Object outcome=tx.execute(status->{
                Instant now=clock.instant().truncatedTo(ChronoUnit.MICROS);
                Account account=dao.account(request.loginId());
                boolean matches=encoder.matches(request.password(),account==null?dummyHash:account.passwordHash());
                if(account==null || !matches || !account.enabled()) {
                    dao.audit(null,"LOGIN_FAILURE","INVALID_CREDENTIALS",now);
                    return AuthFailure.credentials();
                }
                byte[] bytes=new byte[32]; random.nextBytes(bytes);
                String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
                Instant expires=now.plusSeconds(ttl);
                dao.issue(hash(token),account.id(),expires);
                dao.audit(account.id(),"LOGIN_SUCCESS","SUCCESS",now);
                return new LoginResponse(account.user(),token,"Bearer",expires);
            });
            if(outcome instanceof AuthFailure failure) throw failure;
            return (LoginResponse)outcome;
        } catch(DataAccessException | org.springframework.transaction.TransactionException e) { throw AuthFailure.unavailable(); }
    }
    public CurrentUser getCurrentUser(String token) {
        if(!validToken(token)) throw AuthFailure.required();
        try {
            CurrentUser user=dao.current(hash(token),clock.instant());
            if(user==null) throw AuthFailure.required();
            return user;
        } catch(DataAccessException | org.springframework.transaction.TransactionException e) { throw AuthFailure.unavailable(); }
    }
    public void logout(String token) {
        if(token==null) return;
        try {
            tx.executeWithoutResult(status->{
                Instant now=clock.instant();
                Long id=dao.revoke(hash(token),now);
                if(id!=null) dao.audit(id,"LOGOUT","REVOKED",now);
            });
        } catch(DataAccessException | org.springframework.transaction.TransactionException e) { throw AuthFailure.unavailable(); }
    }
    /** Opens a session for an account that was just created (CONTRACTS 32.2); runs in the caller's transaction. */
    public LoginResponse issueSession(User user, String auditEvent) {
        Instant now=clock.instant().truncatedTo(ChronoUnit.MICROS);
        byte[] bytes=new byte[32]; random.nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expires=now.plusSeconds(ttl);
        long id=Long.parseLong(user.id());
        dao.issue(hash(token),id,expires);
        dao.audit(id,auditEvent,"SUCCESS",now);
        return new LoginResponse(user,token,"Bearer",expires);
    }
    /** Revokes the other live tokens of an account after its password changed; the token in use stays valid. */
    public void revokeOtherTokens(long accountId, String currentToken) {
        dao.revokeOthers(accountId,hash(currentToken),clock.instant());
        dao.audit(accountId,"PASSWORD_CHANGED","SUCCESS",clock.instant());
    }
    public void accessDenied(CurrentUser user) {
        try { tx.executeWithoutResult(status->dao.audit(Long.parseLong(user.user().id()),"ACCESS_DENIED","ROLE",clock.instant())); }
        catch(DataAccessException | org.springframework.transaction.TransactionException e) { throw AuthFailure.unavailable(); }
    }
    static void validate(LoginRequest request) {
        if(request==null || request.loginId()==null || !request.loginId().matches("^[a-z0-9][a-z0-9._-]{2,63}$") ||
                request.password()==null || request.password().isEmpty() || request.password().getBytes(StandardCharsets.UTF_8).length>72)
            throw AuthFailure.invalid();
    }
    static boolean validToken(String token) { return token!=null && token.matches("[A-Za-z0-9_-]{43}"); }
    public static String bearer(String header, boolean logout) {
        if(header==null) return null;
        if(!header.matches("Bearer [A-Za-z0-9_-]{43}")) throw logout?AuthFailure.invalid():AuthFailure.required();
        return header.substring(7);
    }
    static byte[] hash(String input) {
        try { return MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8)); }
        catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
}
