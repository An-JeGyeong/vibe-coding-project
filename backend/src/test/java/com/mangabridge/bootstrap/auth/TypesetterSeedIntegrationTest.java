package com.mangabridge.bootstrap.auth;
import static org.assertj.core.api.Assertions.*;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.time.Clock;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.transaction.PlatformTransactionManager;
@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.NONE)
@ContextConfiguration(initializers=RequiredEnvironment.class) @ActiveProfiles("local")
class TypesetterSeedIntegrationTest {
 @Autowired JdbcTemplate jdbc; @Autowired PasswordEncoder encoder; @Autowired PlatformTransactionManager manager; @Autowired ConfigurableApplicationContext context;
 @Test void optionalSeedWritesFourThenFiveAndPreservesExistingAccounts() {
   String prefix="test.seed."+UUID.randomUUID().toString().substring(0,12)+".";
   AuthDao dao=new AuthDao(jdbc) {
     @Override AuthModels.Account account(String id){return super.account(prefix+id);}
     @Override void insertAccount(String id,String name,AuthModels.Role role,String hash){super.insertAccount(prefix+id,name,role,hash);}
   };
   MockEnvironment env=new MockEnvironment();env.setActiveProfiles("local");env.setProperty("DEMO_AUTH_SEED_ENABLED","true");
   String password=UUID.randomUUID().toString();
   for(var role:List.of(AuthModels.Role.OPERATOR,AuthModels.Role.TRANSLATOR,AuthModels.Role.REVIEWER,AuthModels.Role.READER))env.setProperty("DEMO_"+role+"_PASSWORD",password);
   var commands=new DemoAuthCommands(dao,encoder,Clock.systemUTC(),env,manager,context);
   try {
     commands.seed();
     var four=jdbc.queryForList("SELECT * FROM demo_account WHERE login_id LIKE ? ORDER BY id",prefix+"%");assertThat(four).hasSize(4);assertThat(dao.account("demo.typesetter")).isNull();
     env.setProperty("DEMO_TYPESETTER_PASSWORD",password);commands.seed();
     var five=jdbc.queryForList("SELECT * FROM demo_account WHERE login_id LIKE ? ORDER BY id",prefix+"%");assertThat(five).hasSize(5);assertThat(five.subList(0,4)).isEqualTo(four);
     var typesetter=dao.account("demo.typesetter");assertThat(typesetter.role()).isEqualTo(AuthModels.Role.TYPESETTER);assertThat(typesetter.displayName()).isEqualTo("데모 식자");assertThat(encoder.matches(password,typesetter.passwordHash())).isTrue();
     commands.seed();assertThat(jdbc.queryForList("SELECT * FROM demo_account WHERE login_id LIKE ? ORDER BY id",prefix+"%")).isEqualTo(five);
     env.setProperty("DEMO_TYPESETTER_PASSWORD",UUID.randomUUID().toString());assertThatThrownBy(commands::seed).isInstanceOf(IllegalStateException.class);assertThat(jdbc.queryForList("SELECT * FROM demo_account WHERE login_id LIKE ? ORDER BY id",prefix+"%")).isEqualTo(five);
   } finally {jdbc.update("DELETE FROM demo_account WHERE login_id LIKE ?",prefix+"%");}
 }
}
