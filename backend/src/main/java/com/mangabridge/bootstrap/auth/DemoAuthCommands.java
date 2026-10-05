package com.mangabridge.bootstrap.auth;

import static com.mangabridge.bootstrap.auth.AuthModels.*;
import java.time.Clock;
import java.util.Arrays;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@Component
public class DemoAuthCommands implements ApplicationRunner {
    private final AuthDao dao; private final PasswordEncoder encoder; private final Clock clock;
    private final Environment env; private final TransactionTemplate tx; private final ConfigurableApplicationContext context;
    public DemoAuthCommands(AuthDao dao,PasswordEncoder encoder,Clock clock,Environment env,PlatformTransactionManager manager,ConfigurableApplicationContext context) {
        this.dao=dao;this.encoder=encoder;this.clock=clock;this.env=env;this.tx=new TransactionTemplate(manager);this.context=context;
    }
    @Override public void run(ApplicationArguments args) {
        boolean seed=env.getProperty("demo-auth-seed",Boolean.class,false);
        boolean cleanup=env.getProperty("demo-auth-cleanup",Boolean.class,false);
        if(!seed && !cleanup) return;
        int code=0;
        try {
            if(seed && cleanup) throw new IllegalStateException("Choose one DemoAuth command");
            if(!env.getProperty("spring.main.web-application-type","").equals("none")) throw new IllegalStateException("DemoAuth command requires web-application-type=none");
            if(seed) seed(); else tx.executeWithoutResult(s->dao.cleanup(clock.instant()));
            System.out.println("DemoAuth command completed");
        } catch(Exception e) { System.err.println("DemoAuth command failed; check approved profile and required environment variables"); code=1; }
        final int result=code;
        System.exit(SpringApplication.exit(context,()->result));
    }
    void seed() {
        if(!env.getProperty("DEMO_AUTH_SEED_ENABLED",Boolean.class,false) ||
                Arrays.stream(env.getActiveProfiles()).noneMatch(p->p.equals("local")||p.equals("demo")) ||
                Arrays.asList(env.getActiveProfiles()).contains("prod")) throw new IllegalStateException("Demo seed not permitted");
        String[] names={"데모 운영자","데모 번역가","데모 감수자","데모 독자"};
        tx.executeWithoutResult(s->{
            for(Role role:Role.values()) {
                String id="demo."+role.name().toLowerCase(java.util.Locale.ROOT);
                String variable="DEMO_"+role.name()+"_PASSWORD";
                String password=env.getProperty(variable);
                try { AuthService.validate(new LoginRequest(id,password)); }
                catch(AuthFailure failure) { System.err.println("Missing or invalid environment variable: "+variable); throw failure; }
                Account old=dao.account(id);
                if(old==null) dao.insertAccount(id,names[role.ordinal()],role,encoder.encode(password));
                else if(old.role()!=role || !old.displayName().equals(names[role.ordinal()]) || !old.enabled() || !encoder.matches(password,old.passwordHash()))
                    throw new IllegalStateException("Existing demo account differs");
            }
        });
    }
}
