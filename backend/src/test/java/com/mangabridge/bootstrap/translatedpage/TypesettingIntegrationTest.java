package com.mangabridge.bootstrap.translatedpage;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.sql.Statement;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(TypesettingIntegrationTest.Fixtures.class)
class TypesettingIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @MockitoSpyBean TranslationPageDao dao;
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao typesettingTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.translatedpage."+UUID.randomUUID();var key=new GeneratedKeyHolder();
            jdbc.update(connection->{
                var statement=connection.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);
                statement.setString(1,login);statement.setString(2,"page fixture");statement.setString(3,role.name());statement.setString(4,encoder.encode(password));return statement;
            },key);
            long id=key.getKey().longValue();
            byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);
            String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            users.put(role,new Identity(id,token));
            jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",digest(token),id,Timestamp.from(Instant.now().plusSeconds(3600)));
        }
    }
    private static byte[] digest(String token) {
        try { return java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
        catch(java.security.NoSuchAlgorithmException failure) { throw new AssertionError(failure); }
    }
    @AfterEach void cleanup() {
        reset(dao);tracking.cleanupAudits();
        for(String id:episodes) {
            jdbc.update("DELETE FROM translation_page_image WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);
            jdbc.update("DELETE FROM source_page_image WHERE episode_id=?",id);
            jdbc.update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?",id);
            jdbc.update("DELETE FROM publication WHERE episode_id=?",id);
            jdbc.update("DELETE FROM review_block_comment WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);
            jdbc.update("DELETE FROM review_decision WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);
            jdbc.update("DELETE FROM translation_block WHERE episode_id=?",id);
            jdbc.update("DELETE FROM translation_version WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode_assignment WHERE episode_id=?",id);
            jdbc.update("DELETE FROM source_block WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode_source_version WHERE episode_id=?",id);
            jdbc.update("DELETE FROM domain_audit WHERE episode_id=?",id);
            jdbc.update("DELETE FROM episode WHERE id=?",id);
        }
        for(var user:users.values()) {
            jdbc.update("DELETE FROM domain_audit WHERE actor_account_id=?",user.id());
            jdbc.update("DELETE FROM auth_token WHERE account_id=?",user.id());
            jdbc.update("DELETE FROM auth_audit WHERE account_id=?",user.id());
            jdbc.update("DELETE FROM demo_account WHERE id=?",user.id());
        }
    }
    private ResponseEntity<JsonNode> call(HttpMethod method,String path,Object body,String token) {
        var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);
        if(token!=null) headers.setBearerAuth(token);
        return http.exchange(path,method,new HttpEntity<>(body,headers),JsonNode.class);
    }
    private ResponseEntity<JsonNode> get(String path) { return call(HttpMethod.GET,path,null,users.get(Role.OPERATOR).token()); }
    private ResponseEntity<JsonNode> publicGet(String id) { return call(HttpMethod.GET,"/api/public/episodes/"+id,null,null); }
    private String create() {
        var response=call(HttpMethod.POST,"/api/episodes",Map.of("title"," history title "),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
        String id=response.getBody().get("id").textValue();episodes.add(id);
        source(id,0,"SECRET_SOURCE");
        assign(id,Role.TRANSLATOR,users.get(Role.TRANSLATOR).id());assign(id,Role.REVIEWER,users.get(Role.REVIEWER).id());
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(201);
        return id;
    }
    private void source(String id,int expected,String prefix) {
        var response=call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",expected,"blocks",List.of(Map.of("pageNo",2,"text",prefix+"1"),Map.of("pageNo",9,"text",prefix+"2"),Map.of("text",prefix+"3"))),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
    }
    private static byte[] png() {return new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3};}
    private static byte[] jpeg() {return new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff,4,5};}
    private static byte[] webp() {return new byte[]{'R','I','F','F',4,0,0,0,'W','E','B','P',6};}
    private ResponseEntity<byte[]> raw(HttpMethod method,String path,byte[] bytes,String type,String token) {
        if(bytes!=null && bytes.length>TranslationPageService.MAX_BYTES) {
            // Send headers first: the server must reject a known oversized body without reading it.
            try(var socket=new java.net.Socket("localhost",port)) {
                socket.setSoTimeout(5000);
                String request=method.name()+" "+path+" HTTP/1.1\r\nHost: localhost:"+port+"\r\nContent-Type: "+type+
                    "\r\nAuthorization: Bearer "+token+"\r\nContent-Length: "+bytes.length+"\r\nConnection: close\r\n\r\n";
                socket.getOutputStream().write(request.getBytes(java.nio.charset.StandardCharsets.US_ASCII));socket.getOutputStream().flush();
                var input=socket.getInputStream();String statusLine=line(input);int status=Integer.parseInt(statusLine.split(" ")[1]);
                var responseHeaders=new HttpHeaders();String header;
                while(!(header=line(input)).isEmpty()) {int colon=header.indexOf(':');responseHeaders.add(header.substring(0,colon),header.substring(colon+1).strip());}
                byte[] responseBody;
                if("chunked".equalsIgnoreCase(responseHeaders.getFirst("Transfer-Encoding"))) {
                    var body=new java.io.ByteArrayOutputStream();int length;
                    while((length=Integer.parseInt(line(input).split(";")[0],16))>0) {body.write(input.readNBytes(length));assertThat(line(input)).isEmpty();}
                    responseBody=body.toByteArray();
                } else responseBody=input.readNBytes((int)responseHeaders.getContentLength());
                return new ResponseEntity<>(responseBody,responseHeaders,HttpStatusCode.valueOf(status));
            } catch(Exception failure) {throw new AssertionError("Oversize HTTP verification failed",failure);}
        }
        var headers=new HttpHeaders();if(type!=null) headers.setContentType(MediaType.parseMediaType(type));if(token!=null) headers.setBearerAuth(token);
        headers.add("X-Role","OPERATOR");headers.add("X-Filename","PRIVATE_FILENAME");
        return http.exchange(path,method,new HttpEntity<>(bytes,headers),byte[].class);
    }
    private static String line(java.io.InputStream input) throws java.io.IOException {
        var bytes=new java.io.ByteArrayOutputStream();int next;
        while((next=input.read())!=-1) {if(next=='\n') break;if(next!='\r') bytes.write(next);}
        if(next==-1 && bytes.size()==0) throw new java.io.EOFException("Missing HTTP response line");
        return bytes.toString(java.nio.charset.StandardCharsets.US_ASCII);
    }
    private String image(String id,String page) {return "/api/my/episodes/"+id+"/translations/1/page-images/"+page;}
    private ResponseEntity<byte[]> save(String id,byte[] bytes,String type) {return raw(HttpMethod.PUT,image(id,"2"),bytes,type,users.get(Role.TRANSLATOR).token());}
    private JsonNode json(ResponseEntity<byte[]> response) {
        try {return new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.getBody());}catch(Exception failure){throw new AssertionError("Expected safe JSON response");}
    }
    private void error(ResponseEntity<byte[]> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        var body=json(response);assertThat(body.fieldNames()).toIterable().containsExactly("error");assertThat(body.path("error").fieldNames()).toIterable().contains("code","message");
        assertThat(body.path("error").path("code").asText()).isEqualTo(code);assertThat(body.toString()).doesNotContain("Exception","jdbc:","SECRET",password,"PRIVATE_FILENAME");
        for(var user:users.values()) assertThat(body.toString()).doesNotContain(user.token());
    }
    private long audit(String id) {return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='TRANSLATION_PAGE_IMAGE_SAVED'",Long.class,id);}
    private void assign(String id,Role role,long account) {
        assertThat(call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/"+role.name().toLowerCase(Locale.ROOT),Map.of("accountId",Long.toString(account)),users.get(Role.OPERATOR).token()).getStatusCode().is2xxSuccessful()).isTrue();
    }

    private long version(String id,int n) {return jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=? AND version_no=?",Long.class,id,n);}
    private String assigned(String id,int n) {return "/api/my/episodes/"+id+"/translations/"+n+"/page-images";}
    private String operator(String id,int n) {return "/api/episodes/"+id+"/translations/"+n+"/page-images";}
    private String pub(String id) {return "/api/public/episodes/"+id+"/pages";}
    private ResponseEntity<byte[]> read(String path,String token) {return raw(HttpMethod.GET,path,null,null,token);}
    private void status(String id,int n,String state) {jdbc.update("UPDATE translation_version SET status=? WHERE episode_id=? AND version_no=?",state,id,n);}
    private void approveFixture(String id,int n) {
        jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) SELECT id,'APPROVED',?,source_version_no,UTC_TIMESTAMP(6) FROM translation_version WHERE episode_id=? AND version_no=?",users.get(Role.REVIEWER).id(),id,n);
        status(id,n,"APPROVED");
    }
    private void publish(String id,int n) {assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/translations/"+n+"/publish",null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);}
    private void lifecycle(String id,String action) {assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/publication/"+action,null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);}
    @Test void approvedOnlyListDetailAndOriginalImagesAreReadOnly() {
        String id=create();String ts=users.get(Role.TYPESETTER).token();assign(id,Role.TYPESETTER,users.get(Role.TYPESETTER).id());String path="/api/my/episodes/"+id+"/typesetting";
        var before=jdbc.queryForList("SELECT * FROM translation_version WHERE episode_id=?",id);long audits=jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit",Long.class);
        var empty=call(HttpMethod.GET,path,null,ts);assertThat(empty.getStatusCode().value()).isEqualTo(200);assertThat(empty.getBody().path("items").isEmpty()).isTrue();
        for(String state:List.of("DRAFT","REVIEW_PENDING","REJECTED","INVALIDATED","PUBLISHED","ON_HOLD")){status(id,1,state);assertThat(call(HttpMethod.GET,path+"/1",null,ts).getStatusCode().value()).isEqualTo(404);}
        status(id,1,"DRAFT");approveFixture(id,1);
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,1,1,?)",version(id,1),id,"  translated\ntext  ");
        var detail=call(HttpMethod.GET,path+"/1",null,ts);assertThat(detail.getStatusCode().value()).isEqualTo(200);assertThat(detail.getHeaders().getCacheControl()).isEqualTo("no-store");assertThat(detail.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","sourceVersion","blocks");
        var block=detail.getBody().path("blocks").get(0);assertThat(block.fieldNames()).toIterable().containsExactlyInAnyOrder("seq","pageNo","source","text");assertThat(block.path("source").asText()).isEqualTo("SECRET_SOURCE1");assertThat(block.path("text").asText()).isEqualTo("  translated\ntext  ");
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(201);approveFixture(id,2);
        var list=call(HttpMethod.GET,path,null,ts).getBody().path("items");assertThat(list.size()).isEqualTo(2);assertThat(list.get(0).path("versionNo").intValue()).isEqualTo(2);assertThat(list.get(1).path("versionNo").intValue()).isEqualTo(1);for(var item:list){assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("versionNo","sourceVersion","decidedAt");Instant.parse(item.path("decidedAt").asText());}
        assertThat(raw(HttpMethod.PUT,"/api/episodes/"+id+"/pages/2/image",png(),"image/png",users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(201);
        assertThat(read("/api/my/episodes/"+id+"/pages/2/image",ts).getBody()).isEqualTo(png());assertThat(call(HttpMethod.GET,"/api/my/episodes/"+id+"/pages",null,ts).getStatusCode().value()).isEqualTo(200);
        var rows=jdbc.queryForList("SELECT * FROM translation_version WHERE episode_id=?",id);var count=jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit",Long.class);call(HttpMethod.GET,path,null,ts);call(HttpMethod.GET,path+"/1",null,ts);assertThat(jdbc.queryForList("SELECT * FROM translation_version WHERE episode_id=?",id)).isEqualTo(rows);assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit",Long.class)).isEqualTo(count);
    }
    @Test void typesettingRolesPathsAndImmediateAssignmentRemovalAreEnforced() {
        String id=create();assign(id,Role.TYPESETTER,users.get(Role.TYPESETTER).id());approveFixture(id,1);String path="/api/my/episodes/"+id+"/typesetting";
        for(String route:List.of(path,path+"/1")){assertThat(call(HttpMethod.GET,route,null,null).getStatusCode().value()).isEqualTo(401);for(Role role:Role.values()){var response=call(HttpMethod.GET,route,null,users.get(role).token());assertThat(response.getStatusCode().value()).isEqualTo(role==Role.TYPESETTER?200:403);}}
        String ts=users.get(Role.TYPESETTER).token();for(String number:List.of("0","01","abc","1000000000","999999999"))assertThat(call(HttpMethod.GET,path+"/"+number,null,ts).getStatusCode().value()).isEqualTo(404);
        for(String number:List.of("0","01","abc","1000000000000000000","999999999999999999"))assertThat(call(HttpMethod.GET,"/api/my/episodes/"+number+"/typesetting",null,ts).getStatusCode().value()).isEqualTo(404);
        jdbc.update("DELETE FROM episode_assignment WHERE episode_id=? AND assignee_role='TYPESETTER'",id);assertThat(call(HttpMethod.GET,path,null,ts).getStatusCode().value()).isEqualTo(404);assertThat(call(HttpMethod.GET,path+"/1",null,ts).getStatusCode().value()).isEqualTo(404);assertThat(read("/api/my/episodes/"+id+"/pages/2/image",ts).getStatusCode().value()).isEqualTo(404);
    }
}
