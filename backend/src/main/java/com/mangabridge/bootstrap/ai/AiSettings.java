package com.mangabridge.bootstrap.ai;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

@Component
public class AiSettings {
    private final Environment environment;
    public AiSettings(Environment environment) { this.environment=environment; }
    private String value(String name,String fallback) {
        String value=environment.getProperty(name);return value==null||value.isBlank()?fallback:value;
    }
    public String provider() {
        String provider=value("AI_PROVIDER","mock");
        if(!provider.equals("mock")&&!provider.equals("anthropic")) throw AiFailure.unavailable();
        return provider;
    }
    public Configuration configuration() {
        String provider=provider();
        int timeout=number("AI_TIMEOUT_SECONDS",30,1,120),tokens=number("AI_MAX_OUTPUT_TOKENS",2048,128,8192);
        String key=value("AI_API_KEY","");
        if(provider.equals("anthropic")&&key.isBlank()) throw AiFailure.unavailable();
        return new Configuration(provider,key,value("AI_MODEL","claude-haiku-4-5-20251001"),timeout,tokens);
    }
    private int number(String name,int fallback,int min,int max) {
        try {
            int value=Integer.parseInt(value(name,Integer.toString(fallback)));
            if(value<min||value>max) throw AiFailure.unavailable();return value;
        } catch(NumberFormatException invalid) { throw AiFailure.unavailable(); }
    }
    public record Configuration(String provider,String key,String model,int timeoutSeconds,int maxOutputTokens) {
        @Override public String toString() { return "Configuration[redacted]"; }
    }
}
