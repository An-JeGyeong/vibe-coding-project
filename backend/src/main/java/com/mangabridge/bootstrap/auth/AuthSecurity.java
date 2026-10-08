package com.mangabridge.bootstrap.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.context.annotation.*;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.web.cors.CorsConfigurationSource;

@Configuration
@ConditionalOnWebApplication(type=ConditionalOnWebApplication.Type.SERVLET)
@EnableMethodSecurity
public class AuthSecurity {
    @Bean SecurityFilterChain authChain(HttpSecurity http,AuthService service,ObjectMapper mapper) throws Exception {
        http.csrf(csrf->csrf.disable()).cors(cors->cors.disable())
            .sessionManagement(session->session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .requestCache(cache->cache.disable()).formLogin(form->form.disable()).httpBasic(basic->basic.disable())
            .logout(logout->logout.disable())
            .authorizeHttpRequests(auth->auth
                .requestMatchers(org.springframework.http.HttpMethod.OPTIONS,"/**").permitAll()
                .requestMatchers("/api/public","/api/public/**").permitAll()
                .requestMatchers("/api/health","/api/auth/login","/api/auth/logout","/error").permitAll()
                .requestMatchers("/api/episodes","/api/episodes/**").hasRole("OPERATOR")
                .requestMatchers("/api/assignable-accounts").hasRole("OPERATOR")
                .requestMatchers("/api/history").hasRole("OPERATOR")
                .requestMatchers("/api/my/episodes/*/pages","/api/my/episodes/*/pages/**").hasAnyRole("TRANSLATOR","REVIEWER")
                .requestMatchers(org.springframework.http.HttpMethod.PUT,"/api/my/episodes/*/translations/*/page-images/**").hasRole("TRANSLATOR")
                .requestMatchers("/api/my/episodes/*/translations/*/page-images","/api/my/episodes/*/translations/*/page-images/**").hasAnyRole("TRANSLATOR","REVIEWER")
                .requestMatchers("/api/my/episodes/*/translations","/api/my/episodes/*/translations/**").hasRole("TRANSLATOR")
                .requestMatchers("/api/my/reviews","/api/my/episodes/*/reviews","/api/my/episodes/*/reviews/**").hasRole("REVIEWER")
                .requestMatchers("/api/my/**").hasAnyRole("TRANSLATOR","REVIEWER")
                .anyRequest().authenticated())
            .exceptionHandling(errors->errors
                .authenticationEntryPoint((request,response,error)->AuthErrors.write(response,mapper,AuthFailure.required()))
                .accessDeniedHandler((request,response,error)->{
                    try {
                        var authentication=SecurityContextHolder.getContext().getAuthentication();
                        if(authentication!=null && authentication.getPrincipal() instanceof AuthModels.CurrentUser user) service.accessDenied(user);
                        AuthErrors.write(response,mapper,AuthFailure.forbidden());
                    } catch(AuthFailure failure) { AuthErrors.write(response,mapper,failure); }
                }))
            .addFilterBefore(new BearerFilter(service,mapper),UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
    private static class BearerFilter extends OncePerRequestFilter {
        private final AuthService service; private final ObjectMapper mapper;
        BearerFilter(AuthService service,ObjectMapper mapper) {this.service=service;this.mapper=mapper;}
        @Override protected boolean shouldNotFilter(HttpServletRequest r) {
            return r.getMethod().equals("OPTIONS") || r.getServletPath().equals("/api/public") || r.getServletPath().startsWith("/api/public/")
                    || List.of("/api/health","/api/auth/login","/api/auth/logout","/error").contains(r.getServletPath());
        }
        @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain) throws IOException,ServletException {
            try {
                String token=AuthService.bearer(request.getHeader("Authorization"),false);
                if(token!=null) {
                    var user=service.getCurrentUser(token);
                    var authentication=new UsernamePasswordAuthenticationToken(user,null,List.of(new SimpleGrantedAuthority("ROLE_"+user.user().role().name())));
                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            } catch(AuthFailure failure) { AuthErrors.write(response,mapper,failure); return; }
            chain.doFilter(request,response);
        }
    }
}
