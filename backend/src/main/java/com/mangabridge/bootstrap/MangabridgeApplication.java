package com.mangabridge.bootstrap;

import com.mangabridge.bootstrap.config.RequiredEnvironment;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class MangabridgeApplication {
    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(MangabridgeApplication.class);
        application.addInitializers(new RequiredEnvironment());
        try {
            application.run(args);
        } catch (RuntimeException failure) {
            // Do not print nested JDBC/Flyway exceptions containing connection details.
            System.err.println("Startup failed: check required environment variables and MySQL availability.");
            System.exit(1);
        }
    }
}
