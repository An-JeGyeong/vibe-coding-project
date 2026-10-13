package com.mangabridge.bootstrap;

import org.junit.jupiter.api.Test;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;
import static org.assertj.core.api.Assertions.assertThat;

/** The cloud demo profile (DEPLOY_VERCEL.md): an encrypted but not host-verified connection by default, never an unencrypted one. */
class DemoProfileConfigTest {
    private static final String SSL = "spring.datasource.hikari.data-source-properties.sslMode";

    private MockEnvironment environmentWith(String... properties) throws Exception {
        MockEnvironment environment = new MockEnvironment();
        for (int i = 0; i < properties.length; i += 2) environment.setProperty(properties[i], properties[i + 1]);
        environment.getPropertySources().addLast(new YamlPropertySourceLoader()
                .load("demo", new ClassPathResource("application-demo.yml")).get(0));
        return environment;
    }

    @Test void defaultsToAnEncryptedConnection() throws Exception {
        assertThat(environmentWith().getProperty(SSL)).isEqualTo("REQUIRED");
    }

    @Test void theModeCanBeStrengthenedByTheEnvironment() throws Exception {
        assertThat(environmentWith("DB_SSL_MODE", "VERIFY_IDENTITY").getProperty(SSL)).isEqualTo("VERIFY_IDENTITY");
    }

    @Test void neverEnablesPublicKeyRetrievalOrAnUnencryptedDefault() throws Exception {
        MockEnvironment environment = environmentWith();
        assertThat(environment.getProperty("spring.datasource.hikari.data-source-properties.allowPublicKeyRetrieval")).isNull();
        assertThat(environment.getProperty(SSL)).isNotEqualToIgnoringCase("DISABLED");
    }
}
