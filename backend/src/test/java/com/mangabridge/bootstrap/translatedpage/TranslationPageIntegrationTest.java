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
@Import(TranslationPageIntegrationTest.Fixtures.class)
class TranslationPageIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @MockitoSpyBean TranslationPageDao dao;
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private final Set<Long> extraAccounts=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao translatedPageTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
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
        for(long account:extraAccounts){jdbc.update("DELETE FROM auth_token WHERE account_id=?",account);jdbc.update("DELETE FROM auth_audit WHERE account_id=?",account);jdbc.update("DELETE FROM demo_account WHERE id=?",account);}
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
        assign(id,Role.TRANSLATOR,users.get(Role.TRANSLATOR).id());assign(id,Role.REVIEWER,users.get(Role.REVIEWER).id());assign(id,Role.TYPESETTER,users.get(Role.TYPESETTER).id());
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(201);
        approveFixture(id,1);return id;
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
    private ResponseEntity<byte[]> save(String id,byte[] bytes,String type) {return raw(HttpMethod.PUT,image(id,"2"),bytes,type,users.get(Role.TYPESETTER).token());}
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
        if(jdbc.queryForObject("SELECT COUNT(*) FROM review_decision WHERE translation_version_id=?",Integer.class,version(id,n))==0) jdbc.update("INSERT INTO review_decision(translation_version_id,decision,reviewer_id,source_version_no,decided_at) SELECT id,'APPROVED',?,source_version_no,UTC_TIMESTAMP(6) FROM translation_version WHERE episode_id=? AND version_no=?",users.get(Role.REVIEWER).id(),id,n);
        status(id,n,"APPROVED");
    }
    private void publish(String id,int n) {assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/translations/"+n+"/publish",null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);}
    private void lifecycle(String id,String action) {assertThat(call(HttpMethod.POST,"/api/episodes/"+id+"/publication/"+action,null,users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(200);}
    @Test void threeFormatsRoundTripAndAuditHistoryMetadataRevisionRemainCorrect() {
        String id=create();long v=version(id,1);var before=jdbc.queryForMap("SELECT * FROM translation_version WHERE id=?",v);int count=0;
        for(var pair:List.of(Map.entry("image/png",png()),Map.entry("image/jpeg",jpeg()),Map.entry("image/webp",webp()))) {
            var saved=save(id,pair.getValue(),pair.getKey());assertThat(saved.getStatusCode().value()).isEqualTo(count++==0?201:200);
            var metadata=json(saved);assertThat(metadata.fieldNames()).toIterable().containsExactlyInAnyOrder("pageNo","contentType","byteSize","updatedAt");assertThat(metadata.path("pageNo").intValue()).isEqualTo(2);
            assertThat(metadata.path("contentType").asText()).isEqualTo(pair.getKey());assertThat(metadata.path("byteSize").intValue()).isEqualTo(pair.getValue().length);Instant.parse(metadata.path("updatedAt").asText());assertThat(metadata.path("updatedAt").asText()).endsWith("Z");
            for(String path:List.of(image(id,"2"),operator(id,1)+"/2")) {
                var r=read(path,path.equals(image(id,"2"))?users.get(Role.TYPESETTER).token():users.get(Role.OPERATOR).token());
                assertThat(r.getStatusCode().value()).isEqualTo(200);assertThat(r.getBody()).isEqualTo(pair.getValue());assertThat(r.getHeaders().getContentType().toString()).isEqualTo(pair.getKey());assertThat(r.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");assertThat(r.getHeaders().getCacheControl()).isEqualTo("no-store");
            }
        }
        assertThat(audit(id)).isEqualTo(3);assertThat(jdbc.queryForMap("SELECT * FROM translation_version WHERE id=?",v)).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_block WHERE translation_version_id=?",Long.class,v)).isZero();
        for(var row:jdbc.queryForList("SELECT * FROM domain_audit WHERE episode_id=? AND event='TRANSLATION_PAGE_IMAGE_SAVED'",id)) {
            assertThat(row.get("actor_account_id")).isEqualTo(users.get(Role.TYPESETTER).id());assertThat(row.get("source_version")).isEqualTo(1);assertThat(row.get("translation_version_id")).isEqualTo(v);assertThat(row.toString()).doesNotContain("PRIVATE_FILENAME","SECRET_SOURCE");
        }
        var history=get("/api/history?event=TRANSLATION_PAGE_IMAGE_SAVED&episodeId="+id);assertThat(history.getStatusCode().value()).isEqualTo(200);assertThat(history.getBody().path("total").intValue()).isEqualTo(3);assertThat(history.getBody().toString()).doesNotContain("image_data","PRIVATE_FILENAME","SECRET_SOURCE","image/png");
    }
    @Test void listSortingMetadataAndMissingImages() {
        String id=create();String tr=users.get(Role.TYPESETTER).token();assertThat(json(read(assigned(id,1),tr)).path("items").isEmpty()).isTrue();
        assertThat(raw(HttpMethod.PUT,assigned(id,1)+"/9",webp(),"image/webp",tr).getStatusCode().value()).isEqualTo(201);save(id,png(),"image/png");
        var r=read(assigned(id,1),tr);assertThat(r.getHeaders().getCacheControl()).isEqualTo("no-store");var list=json(r);assertThat(list.fieldNames()).toIterable().containsExactly("items");assertThat(list.path("items").get(0).path("pageNo").intValue()).isEqualTo(2);assertThat(list.path("items").get(1).path("pageNo").intValue()).isEqualTo(9);
        for(var item:list.path("items")) assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("pageNo","contentType","byteSize","updatedAt");
        assertThat(json(read(operator(id,1),users.get(Role.OPERATOR).token()))).isEqualTo(list);error(read(assigned(id,1)+"/3",tr),404,"NOT_FOUND");
    }
    @Test void invalidFormatsSignaturesEmptyOversizeAndFiveMiBBoundary() {
        String id=create();
        for(String type:List.of("image/svg+xml","image/gif","application/json","application/x-www-form-urlencoded","text/plain","application/octet-stream")) error(save(id,png(),type),400,"INVALID_REQUEST");
        for(String type:List.of("image/png","image/jpeg","image/webp")){error(save(id,new byte[0],type),400,"INVALID_REQUEST");error(save(id,new byte[]{1,2,3},type),400,"INVALID_REQUEST");}
        error(save(id,jpeg(),"image/png"),400,"INVALID_REQUEST");error(save(id,png(),"image/jpeg"),400,"INVALID_REQUEST");error(save(id,Arrays.copyOf(webp(),11),"image/webp"),400,"INVALID_REQUEST");assertThat(audit(id)).isZero();
        var boundary=Arrays.copyOf(png(),TranslationPageService.MAX_BYTES);boundary[boundary.length-1]=77;
        assertThat(save(id,boundary,"image/png").getStatusCode().value()).isEqualTo(201);assertThat(read(image(id,"2"),users.get(Role.TYPESETTER).token()).getBody()).isEqualTo(boundary);
        error(save(id,Arrays.copyOf(boundary,boundary.length+1),"image/png"),400,"INVALID_REQUEST");assertThat(read(image(id,"2"),users.get(Role.TYPESETTER).token()).getBody()).isEqualTo(boundary);assertThat(audit(id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT @@max_allowed_packet",Long.class)).isGreaterThan(TranslationPageService.MAX_BYTES);
    }
    @Test void allNonApprovedStatesAreImmutableAndReadersHaveDistinctVisibility() {
        String id=create();save(id,png(),"image/png");String ts=users.get(Role.TYPESETTER).token(),rv=users.get(Role.REVIEWER).token(),tr=users.get(Role.TRANSLATOR).token();
        for(String state:List.of("DRAFT","REVIEW_PENDING","APPROVED","REJECTED","INVALIDATED","PUBLISHED","ON_HOLD")){
            status(id,1,state);
            for(String path:List.of(assigned(id,1),image(id,"2"))){error(read(path,tr),403,"FORBIDDEN");var typesetter=read(path,ts);if(state.equals("APPROVED"))assertThat(typesetter.getStatusCode().value()).isEqualTo(200);else error(typesetter,404,"NOT_FOUND");var reviewer=read(path,rv);if(Set.of("REVIEW_PENDING","APPROVED","REJECTED").contains(state))assertThat(reviewer.getStatusCode().value()).isEqualTo(200);else error(reviewer,404,"NOT_FOUND");}
            assertThat(read(operator(id,1)+"/2",users.get(Role.OPERATOR).token()).getBody()).isEqualTo(png());
            if(!state.equals("APPROVED")){var response=save(id,jpeg(),"image/jpeg");error(response,409,"STATE_CONFLICT");assertThat(json(response).path("error").fieldNames()).toIterable().containsExactlyInAnyOrder("code","message","currentStatus");assertThat(json(response).path("error").path("currentStatus").asText()).isEqualTo(state);}
        }
        assertThat(audit(id)).isEqualTo(1);
    }
    @Test void roleMatrixRejectsForgedRoleAndUnauthenticatedRequests() {
        String id=create();for(Role role:Role.values()){var response=raw(HttpMethod.PUT,image(id,"2"),png(),"image/png",users.get(role).token());if(role==Role.TYPESETTER)assertThat(response.getStatusCode().value()).isEqualTo(201);else error(response,403,"FORBIDDEN");}
        for(Role role:Role.values()){
            for(String path:List.of(assigned(id,1),image(id,"2"))){var response=read(path,users.get(role).token());if(role==Role.TYPESETTER||role==Role.REVIEWER)assertThat(response.getStatusCode().value()).isEqualTo(200);else error(response,403,"FORBIDDEN");}
            for(String path:List.of(operator(id,1),operator(id,1)+"/2")){var response=read(path,users.get(role).token());if(role==Role.OPERATOR)assertThat(response.getStatusCode().value()).isEqualTo(200);else error(response,403,"FORBIDDEN");}
        }
        for(String path:List.of(assigned(id,1),image(id,"2"),operator(id,1),operator(id,1)+"/2"))error(read(path,null),401,"AUTH_REQUIRED");error(raw(HttpMethod.PUT,image(id,"2"),png(),"image/png",null),401,"AUTH_REQUIRED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?,?,?)",Long.class,users.get(Role.OPERATOR).id(),users.get(Role.TRANSLATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id(),users.get(Role.TYPESETTER).id())).isEqualTo(18);
        var headers=new HttpHeaders();headers.setBearerAuth(users.get(Role.TRANSLATOR).token());headers.set("X-Role","TYPESETTER");headers.setContentType(MediaType.IMAGE_PNG);error(http.exchange(image(id,"2"),HttpMethod.PUT,new HttpEntity<>(png(),headers),byte[].class),403,"FORBIDDEN");
    }
    @Test void pageAndVersionPathMissingSourceAndAssignmentReplacement() {
        String id=create();save(id,png(),"image/png");String ts=users.get(Role.TYPESETTER).token();
        for(String page:List.of("0","-1","01","10000","abc","9999","3"))error(raw(HttpMethod.PUT,image(id,page),png(),"image/png",ts),404,"NOT_FOUND");
        for(String n:List.of("0","01","abc","999999999","1000000000"))error(read("/api/my/episodes/"+id+"/translations/"+n+"/page-images",ts),404,"NOT_FOUND");
        for(String episode:List.of("0","01","abc","999999999999999999","1000000000000000000"))error(read(assigned(episode,1),ts),404,"NOT_FOUND");
        for(Role role:List.of(Role.TYPESETTER,Role.REVIEWER)){
            var key=new GeneratedKeyHolder();jdbc.update(c->{var ps=c.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);ps.setString(1,"test.image.next."+UUID.randomUUID());ps.setString(2,"next image assignee");ps.setString(3,role.name());ps.setString(4,encoder.encode(password));return ps;},key);long account=key.getKey().longValue();extraAccounts.add(account);
            assign(id,role,account);for(String path:List.of(assigned(id,1),image(id,"2")))error(read(path,users.get(role).token()),404,"NOT_FOUND");if(role==Role.TYPESETTER)error(save(id,jpeg(),"image/jpeg"),404,"NOT_FOUND");
            byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",digest(token),account,Timestamp.from(Instant.now().plusSeconds(600)));
            if(role==Role.TYPESETTER){assertThat(read(image(id,"2"),token).getBody()).isEqualTo(png());assertThat(raw(HttpMethod.PUT,image(id,"2"),jpeg(),"image/jpeg",token).getStatusCode().value()).isEqualTo(200);}else assertThat(read(image(id,"2"),token).getBody()).isEqualTo(jpeg());
        }
        String other=create();jdbc.update("DELETE FROM episode_assignment WHERE episode_id=? AND assignee_role='TYPESETTER'",other);error(read(assigned(other,1),ts),404,"NOT_FOUND");
    }
    @Test void sourceChangeUsesVersionBoundPagesAndNewDraftDoesNotCopyImages() {
        String id=create();save(id,png(),"image/png");source(id,1,"NEW_SOURCE");var response=save(id,jpeg(),"image/jpeg");error(response,409,"STATE_CONFLICT");assertThat(json(response).path("error").path("currentStatus").asText()).isEqualTo("INVALIDATED");error(read(image(id,"2"),users.get(Role.TYPESETTER).token()),404,"NOT_FOUND");assertThat(read(operator(id,1)+"/2",users.get(Role.OPERATOR).token()).getBody()).isEqualTo(png());
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,users.get(Role.TRANSLATOR).token()).getStatusCode().value()).isEqualTo(201);assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_page_image WHERE translation_version_id=?",Long.class,version(id,2))).isZero();error(read(assigned(id,2),users.get(Role.TYPESETTER).token()),404,"NOT_FOUND");
    }
    @Test void auditAndImageFailuresRollBackAndReadDatabaseErrorsAreSafe503() {
        String id=create();doThrow(new DataAccessResourceFailureException("SECRET audit")).when(dao).audit(anyLong(),anyLong(),anyInt(),anyLong(),any());error(save(id,png(),"image/png"),503,"SERVICE_UNAVAILABLE");assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_page_image WHERE translation_version_id=?",Long.class,version(id,1))).isZero();assertThat(audit(id)).isZero();
        reset(dao);save(id,png(),"image/png");var before=jdbc.queryForMap("SELECT * FROM translation_page_image WHERE translation_version_id=?",version(id,1));
        doThrow(new DataAccessResourceFailureException("SECRET audit")).when(dao).audit(anyLong(),anyLong(),anyInt(),anyLong(),any());error(save(id,jpeg(),"image/jpeg"),503,"SERVICE_UNAVAILABLE");var after=jdbc.queryForMap("SELECT * FROM translation_page_image WHERE translation_version_id=?",version(id,1));assertThat(after.remove("image_data")).isEqualTo(before.remove("image_data"));assertThat(after).isEqualTo(before);assertThat(audit(id)).isEqualTo(1);
        reset(dao);doThrow(new DataAccessResourceFailureException("SECRET save")).when(dao).save(anyLong(),anyInt(),anyString(),any(),anyLong(),any());error(save(id,jpeg(),"image/jpeg"),503,"SERVICE_UNAVAILABLE");assertThat(audit(id)).isEqualTo(1);
        reset(dao);doThrow(new DataAccessResourceFailureException("SECRET read")).when(dao).list(anyLong());error(read(assigned(id,1),users.get(Role.TYPESETTER).token()),503,"SERVICE_UNAVAILABLE");
        reset(dao);doThrow(new DataAccessResourceFailureException("SECRET public")).when(dao).publicVersion(anyLong());error(read(pub(id),null),503,"SERVICE_UNAVAILABLE");
    }
    @Test void concurrentUploadsSerializeWithOneRowAndTwoAudits() throws Exception {
        String id=create();var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try {var a=pool.submit(()->{start.await();return save(id,jpeg(),"image/jpeg");});var b=pool.submit(()->{start.await();return save(id,webp(),"image/webp");});start.countDown();var first=a.get(15,TimeUnit.SECONDS);var second=b.get(15,TimeUnit.SECONDS);assertThat(List.of(first.getStatusCode().value(),second.getStatusCode().value())).containsExactlyInAnyOrder(201,200);
            var last=first.getStatusCode().value()==200?first:second;assertThat(json(read(assigned(id,1),users.get(Role.TYPESETTER).token())).path("items").get(0)).isEqualTo(json(last));assertThat(audit(id)).isEqualTo(2);
        }finally{pool.shutdownNow();}
    }
    @Test void publicPointerOnlyHoldResumeSourceChangesAndReplacementNeverExposeOriginal() {
        String id=create();String tr=users.get(Role.TRANSLATOR).token(),ts=users.get(Role.TYPESETTER).token();save(id,png(),"image/png");assertThat(raw(HttpMethod.PUT,"/api/episodes/"+id+"/pages/2/image",jpeg(),"image/jpeg",users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(201);
        var unavailable=read(pub(id),null);error(unavailable,404,"NOT_FOUND");assertThat(read(pub("999999999999999999"),null).getBody()).isEqualTo(unavailable.getBody());publish(id,1);
        var list=read(pub(id),null);assertThat(json(list).fieldNames()).toIterable().containsExactly("items");assertThat(json(list).path("items").get(0).fieldNames()).toIterable().containsExactly("pageNo");assertThat(json(list).path("items").get(0).path("pageNo").intValue()).isEqualTo(2);assertThat(list.getHeaders().getCacheControl()).isEqualTo("no-store");
        var image=read(pub(id)+"/2/image",null);assertThat(image.getBody()).isEqualTo(png());assertThat(image.getHeaders().getFirst("Cross-Origin-Resource-Policy")).isNull();assertThat(image.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");assertThat(image.getHeaders().getCacheControl()).isEqualTo("no-store");error(read(pub(id)+"/9/image",null),404,"NOT_FOUND");
        error(save(id,jpeg(),"image/jpeg"),409,"STATE_CONFLICT");lifecycle(id,"hold");assertThat(read(pub(id),null).getBody()).isEqualTo(unavailable.getBody());assertThat(read(pub(id)+"/2/image",null).getBody()).isEqualTo(unavailable.getBody());lifecycle(id,"resume");assertThat(read(pub(id)+"/2/image",null).getBody()).isEqualTo(png());
        assertThat(call(HttpMethod.POST,"/api/my/episodes/"+id+"/translations",null,tr).getStatusCode().value()).isEqualTo(201);assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM translation_page_image WHERE translation_version_id=?",Long.class,version(id,2))).isZero();error(read(assigned(id,2),ts),404,"NOT_FOUND");approveFixture(id,2);assertThat(raw(HttpMethod.PUT,assigned(id,2)+"/2",webp(),"image/webp",ts).getStatusCode().value()).isEqualTo(201);assertThat(read(pub(id)+"/2/image",null).getBody()).isEqualTo(png());publish(id,2);assertThat(read(pub(id)+"/2/image",null).getBody()).isEqualTo(webp());
        source(id,1,"CHANGED_SOURCE");assertThat(read(pub(id)+"/2/image",null).getBody()).isEqualTo(webp());assertThat(json(read(pub(id),null))).isEqualTo(json(list));String empty=create();publish(empty,1);assertThat(json(read(pub(empty),null)).path("items").isEmpty()).isTrue();assertThat(read(pub(empty)+"/2/image",null).getBody()).isEqualTo(unavailable.getBody());
    }
    @Test void publicAuthenticationIgnoredAllMethodsAndCorsRules() {
        String id=create();save(id,png(),"image/png");approveFixture(id,1);publish(id,1);
        jdbc.update("UPDATE auth_token SET expires_at=? WHERE account_id=?",Timestamp.from(Instant.now().minusSeconds(60)),users.get(Role.READER).id());
        for(String token:Arrays.asList(null,"tampered-token",users.get(Role.READER).token(),users.get(Role.TRANSLATOR).token(),users.get(Role.REVIEWER).token(),users.get(Role.OPERATOR).token())) {
            assertThat(read(pub(id),token).getStatusCode().value()).isEqualTo(200);assertThat(read(pub(id)+"/2/image",token).getBody()).isEqualTo(png());
        }
        for(String path:List.of(pub(id),pub(id)+"/2/image")) for(var method:List.of(HttpMethod.POST,HttpMethod.PUT,HttpMethod.PATCH,HttpMethod.DELETE,HttpMethod.HEAD)) {
            var r=raw(method,path,null,null,"malformed-token");assertThat(r.getStatusCode().value()).isEqualTo(405);assertThat(r.getHeaders().getCacheControl()).isEqualTo("no-store");
        }
        var headers=new HttpHeaders();headers.setOrigin("https://forbidden.example");assertThat(http.exchange(pub(id),HttpMethod.GET,new HttpEntity<>(headers),byte[].class).getStatusCode().value()).isEqualTo(403);
        headers.setOrigin("http://localhost:3000");headers.setAccessControlRequestMethod(HttpMethod.PUT);headers.setAccessControlRequestHeaders(List.of("authorization","content-type"));
        var preflight=http.exchange(image(id,"2"),HttpMethod.OPTIONS,new HttpEntity<>(headers),byte[].class);assertThat(preflight.getStatusCode().value()).isEqualTo(200);assertThat(preflight.getHeaders().getAccessControlAllowOrigin()).isEqualTo("http://localhost:3000");assertThat(preflight.getHeaders().getAccessControlAllowHeaders()).contains("authorization","content-type");
    }
    private void violation(String sql,int expected,Object...args) {
        assertThatThrownBy(()->jdbc.update(sql,args)).isInstanceOfSatisfying(org.springframework.dao.DataAccessException.class,failure->{Throwable cause=failure;while(cause!=null&&!(cause instanceof java.sql.SQLException)) cause=cause.getCause();assertThat(cause).isInstanceOf(java.sql.SQLException.class);assertThat(((java.sql.SQLException)cause).getErrorCode()).isEqualTo(expected);});
    }
    @Test void schemaNotNullChecksPrimaryForeignKeysRestrictAndCollation() {
        String id=create();long v=version(id,1),actor=users.get(Role.TYPESETTER).id();String sql="INSERT INTO translation_page_image(translation_version_id,page_no,content_type,byte_size,image_data,uploaded_by,updated_at) VALUES (?,?,?,?,?,?,?)";
        Object[] valid={v,2,"image/png",png().length,png(),actor,Timestamp.from(Instant.now())};
        for(int i=0;i<valid.length;i++){var values=valid.clone();values[i]=null;violation(sql,1048,values);}
        for(var pair:List.of(Map.entry(1,0),Map.entry(1,10000),Map.entry(2,"image/gif"),Map.entry(3,0),Map.entry(3,5242881))) {var values=valid.clone();values[pair.getKey()]=pair.getValue();violation(sql,3819,values);}
        var bad=valid.clone();bad[0]=999999999999999999L;violation(sql,1452,bad);bad=valid.clone();bad[5]=999999999999999999L;violation(sql,1452,bad);
        assertThat(jdbc.update(sql,valid)).isEqualTo(1);violation(sql,1062,valid);violation("DELETE FROM translation_version WHERE id=?",1451,v);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='translation_page_image' AND IS_NULLABLE='NO'",Integer.class)).isEqualTo(7);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='translation_page_image' AND UPDATE_RULE='RESTRICT' AND DELETE_RULE='RESTRICT'",Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='translation_page_image' AND COLUMN_NAME='content_type' AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin'",Integer.class)).isEqualTo(1);
    }
}
