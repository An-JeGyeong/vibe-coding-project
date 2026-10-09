package com.mangabridge.bootstrap.page;

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
@Import(PageIntegrationTest.Fixtures.class)
class PageIntegrationTest {
    @Autowired TestRestTemplate http;
    @Autowired JdbcTemplate jdbc;
    @Autowired PasswordEncoder encoder;
    @Autowired TrackingAuthDao tracking;
    @org.springframework.boot.test.web.server.LocalServerPort int port;
    @MockitoSpyBean PageDao dao;
    private final Map<Role,Identity> users=new EnumMap<>(Role.class);
    private final Set<String> episodes=new HashSet<>();
    private String password;
    private record Identity(long id,String token) { }
    @TestConfiguration static class Fixtures {
        @Bean @Primary TrackingAuthDao pageTrackingAuthDao(JdbcTemplate jdbc) { return new TrackingAuthDao(jdbc); }
    }
    @BeforeEach void setup() {
        password=UUID.randomUUID().toString();
        for(Role role:Role.values()) {
            String login="test.page."+UUID.randomUUID();var key=new GeneratedKeyHolder();
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
        source(id,0,"SECRET_SOURCE");return id;
    }
    private void source(String id,int expected,String prefix) {
        var response=call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",expected,"blocks",List.of(Map.of("pageNo",2,"text",prefix+"1"),Map.of("text",prefix+"2"))),users.get(Role.OPERATOR).token());
        assertThat(response.getStatusCode().value()).isEqualTo(201);
    }
    private static byte[] png() {return new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3};}
    private static byte[] jpeg() {return new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff,4,5};}
    private static byte[] webp() {return new byte[]{'R','I','F','F',4,0,0,0,'W','E','B','P',6};}
    private ResponseEntity<byte[]> raw(HttpMethod method,String path,byte[] bytes,String type,String token) {
        if(bytes!=null && bytes.length>PageService.MAX_BYTES) {
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
    private String image(String id,String page) {return "/api/episodes/"+id+"/pages/"+page+"/image";}
    private ResponseEntity<byte[]> save(String id,byte[] bytes,String type) {return raw(HttpMethod.PUT,image(id,"2"),bytes,type,users.get(Role.OPERATOR).token());}
    private JsonNode json(ResponseEntity<byte[]> response) {
        try {return new com.fasterxml.jackson.databind.ObjectMapper().readTree(response.getBody());}catch(Exception failure){throw new AssertionError("Expected safe JSON response");}
    }
    private void error(ResponseEntity<byte[]> response,int status,String code) {
        assertThat(response.getStatusCode().value()).isEqualTo(status);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");
        var body=json(response);assertThat(body.fieldNames()).toIterable().containsExactly("error");assertThat(body.path("error").fieldNames()).toIterable().containsExactlyInAnyOrder("code","message");
        assertThat(body.path("error").path("code").asText()).isEqualTo(code);assertThat(body.toString()).doesNotContain("Exception","jdbc:","SECRET",password,"PRIVATE_FILENAME");
        for(var user:users.values()) assertThat(body.toString()).doesNotContain(user.token());
    }
    private long audit(String id) {return jdbc.queryForObject("SELECT COUNT(*) FROM domain_audit WHERE episode_id=? AND event='PAGE_IMAGE_SAVED'",Long.class,id);}
    private void assign(String id,Role role,long account) {
        assertThat(call(HttpMethod.PUT,"/api/episodes/"+id+"/assignments/"+role.name().toLowerCase(Locale.ROOT),Map.of("accountId",Long.toString(account)),users.get(Role.OPERATOR).token()).getStatusCode().is2xxSuccessful()).isTrue();
    }
    @Test void allThreeFormatsRoundTripExactlyWithMetadataAuditAndHistory() {
        String id=create();int count=0;
        for(var pair:List.of(Map.entry("image/png",png()),Map.entry("image/jpeg",jpeg()),Map.entry("image/webp",webp()))) {
            var saved=save(id,pair.getValue(),pair.getKey());assertThat(saved.getStatusCode().value()).isEqualTo(count++==0?201:200);
            var metadata=json(saved);assertThat(metadata.fieldNames()).toIterable().containsExactlyInAnyOrder("pageNo","contentType","byteSize","updatedAt");assertThat(metadata.path("pageNo").intValue()).isEqualTo(2);
            assertThat(metadata.path("contentType").asText()).isEqualTo(pair.getKey());assertThat(metadata.path("byteSize").intValue()).isEqualTo(pair.getValue().length);Instant.parse(metadata.path("updatedAt").asText());assertThat(metadata.path("updatedAt").asText()).endsWith("Z");
            var read=raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token());assertThat(read.getStatusCode().value()).isEqualTo(200);assertThat(read.getBody()).isEqualTo(pair.getValue());assertThat(read.getHeaders().getContentType().toString()).isEqualTo(pair.getKey());assertThat(read.getHeaders().getFirst("X-Content-Type-Options")).isEqualTo("nosniff");assertThat(read.getHeaders().getCacheControl()).isEqualTo("no-store");
        }
        assertThat(audit(id)).isEqualTo(3);
        var rows=jdbc.queryForList("SELECT * FROM domain_audit WHERE episode_id=? AND event='PAGE_IMAGE_SAVED'",id);
        for(var row:rows) {assertThat(row.get("actor_account_id")).isEqualTo(users.get(Role.OPERATOR).id());assertThat(row.get("source_version")).isEqualTo(1);assertThat(row.get("translation_version_id")).isNull();assertThat(row.toString()).doesNotContain("PRIVATE_FILENAME");}
        var history=get("/api/history?event=PAGE_IMAGE_SAVED&episodeId="+id);assertThat(history.getStatusCode().value()).isEqualTo(200);assertThat(history.getBody().path("total").intValue()).isEqualTo(3);assertThat(history.getBody().toString()).doesNotContain("image_data","PRIVATE_FILENAME","SECRET_SOURCE","image/png");
    }
    @Test void listSortingAndImagesSurviveSourceChangesButNewUploadRequiresCurrentPage() {
        String id=create();
        assertThat(get("/api/episodes/"+id+"/pages").getBody().path("items").isEmpty()).isTrue();
        call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",1,"blocks",List.of(Map.of("pageNo",9,"text","nine"),Map.of("pageNo",2,"text","two"))),users.get(Role.OPERATOR).token());
        assertThat(raw(HttpMethod.PUT,image(id,"9"),webp(),"image/webp",users.get(Role.OPERATOR).token()).getStatusCode().value()).isEqualTo(201);assertThat(save(id,png(),"image/png").getStatusCode().value()).isEqualTo(201);
        var list=get("/api/episodes/"+id+"/pages");assertThat(list.getHeaders().getCacheControl()).isEqualTo("no-store");assertThat(list.getBody().fieldNames()).toIterable().containsExactly("items");assertThat(list.getBody().path("items").get(0).path("pageNo").intValue()).isEqualTo(2);assertThat(list.getBody().path("items").get(1).path("pageNo").intValue()).isEqualTo(9);
        for(var item:list.getBody().path("items")) assertThat(item.fieldNames()).toIterable().containsExactlyInAnyOrder("pageNo","contentType","byteSize","updatedAt");
        call(HttpMethod.PUT,"/api/episodes/"+id+"/source",Map.of("expectedVersion",2,"blocks",List.of(Map.of("text","page removed"))),users.get(Role.OPERATOR).token());
        assertThat(raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token()).getBody()).isEqualTo(png());assertThat(get("/api/episodes/"+id+"/pages").getBody()).isEqualTo(list.getBody());error(save(id,jpeg(),"image/jpeg"),404,"NOT_FOUND");assertThat(audit(id)).isEqualTo(2);
    }
    @Test void invalidFormatsMagicEmptyBodyAndOversizeDoNotWrite() {
        String id=create();
        for(String type:List.of("image/svg+xml","image/gif","application/json","application/octet-stream","text/plain")) error(save(id,png(),type),400,"INVALID_REQUEST");
        for(String type:List.of("image/png","image/jpeg","image/webp")) {error(save(id,new byte[0],type),400,"INVALID_REQUEST");error(save(id,new byte[]{1,2,3},type),400,"INVALID_REQUEST");}
        error(save(id,jpeg(),"image/png"),400,"INVALID_REQUEST");error(save(id,png(),"image/jpeg"),400,"INVALID_REQUEST");error(save(id,Arrays.copyOf(webp(),11),"image/webp"),400,"INVALID_REQUEST");
        var tooLarge=Arrays.copyOf(png(),PageService.MAX_BYTES+1);error(save(id,tooLarge,"image/png"),400,"INVALID_REQUEST");assertThat(audit(id)).isZero();assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM source_page_image WHERE episode_id=?",Long.class,id)).isZero();
    }
    @Test void exactlyFiveMiBIsAllowedAndPlusOneRejectedWithoutReplacement() {
        String id=create();var boundary=Arrays.copyOf(png(),PageService.MAX_BYTES);boundary[boundary.length-1]=77;
        assertThat(save(id,boundary,"image/png").getStatusCode().value()).isEqualTo(201);var read=raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token());assertThat(read.getBody()).isEqualTo(boundary);assertThat(read.getBody().length).isEqualTo(5242880);
        error(save(id,Arrays.copyOf(boundary,PageService.MAX_BYTES+1),"image/png"),400,"INVALID_REQUEST");assertThat(raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token()).getBody()).isEqualTo(boundary);assertThat(audit(id)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT @@max_allowed_packet",Long.class)).isGreaterThan(PageService.MAX_BYTES);
    }
    @Test void pathErrorsAndMissingCurrentSourcePagesAre404() {
        String id=create();
        for(String page:List.of("0","-1","01","10000","abc","9999","3")) error(raw(HttpMethod.PUT,image(id,page),png(),"image/png",users.get(Role.OPERATOR).token()),404,"NOT_FOUND");
        for(String episode:List.of("0","01","abc","999999999999999999","1000000000000000000")) error(raw(HttpMethod.PUT,image(episode,"2"),png(),"image/png",users.get(Role.OPERATOR).token()),404,"NOT_FOUND");
        error(raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token()),404,"NOT_FOUND");
        var created=call(HttpMethod.POST,"/api/episodes",Map.of("title","no source"),users.get(Role.OPERATOR).token());String empty=created.getBody().path("id").asText();episodes.add(empty);error(save(empty,png(),"image/png"),404,"NOT_FOUND");assertThat(audit(id)).isZero();
    }
    @Test void roleMatrixAndCurrentAssignmentProtectAllFiveApisIncludingReplacement() {
        String id=create();save(id,png(),"image/png");assign(id,Role.TRANSLATOR,users.get(Role.TRANSLATOR).id());assign(id,Role.REVIEWER,users.get(Role.REVIEWER).id());assign(id,Role.TYPESETTER,users.get(Role.TYPESETTER).id());
        for(Role role:Role.values()) {
            String token=users.get(role).token();boolean operator=role==Role.OPERATOR,assigned=role==Role.TRANSLATOR||role==Role.REVIEWER||role==Role.TYPESETTER;
            var put=raw(HttpMethod.PUT,image(id,"2"),png(),"image/png",token);if(operator) assertThat(put.getStatusCode().value()).isEqualTo(200);else error(put,403,"FORBIDDEN");
            for(String path:List.of("/api/episodes/"+id+"/pages",image(id,"2"))) {var response=raw(HttpMethod.GET,path,null,null,token);if(operator) assertThat(response.getStatusCode().value()).isEqualTo(200);else error(response,403,"FORBIDDEN");}
            for(String path:List.of("/api/my/episodes/"+id+"/pages","/api/my/episodes/"+id+"/pages/2/image")) {var response=raw(HttpMethod.GET,path,null,null,token);if(assigned) assertThat(response.getStatusCode().value()).isEqualTo(200);else error(response,403,"FORBIDDEN");}
        }
        for(String path:List.of("/api/episodes/"+id+"/pages",image(id,"2"),"/api/my/episodes/"+id+"/pages","/api/my/episodes/"+id+"/pages/2/image")) error(raw(HttpMethod.GET,path,null,null,null),401,"AUTH_REQUIRED");error(raw(HttpMethod.PUT,image(id,"2"),png(),"image/png",null),401,"AUTH_REQUIRED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM auth_audit WHERE event='ACCESS_DENIED' AND account_id IN (?,?,?,?)",Long.class,users.get(Role.OPERATOR).id(),users.get(Role.TRANSLATOR).id(),users.get(Role.REVIEWER).id(),users.get(Role.READER).id())).isEqualTo(13);
        String unassigned=create();for(Role role:List.of(Role.TRANSLATOR,Role.REVIEWER,Role.TYPESETTER)) error(raw(HttpMethod.GET,"/api/my/episodes/"+unassigned+"/pages",null,null,users.get(role).token()),404,"NOT_FOUND");
        for(Role role:List.of(Role.TRANSLATOR,Role.REVIEWER)) {
            long replacement=jdbc.queryForObject("SELECT id FROM demo_account WHERE login_id=?",Long.class,"demo."+role.name().toLowerCase(Locale.ROOT));assign(id,role,replacement);
            for(String path:List.of("/api/my/episodes/"+id+"/pages","/api/my/episodes/"+id+"/pages/2/image")) error(raw(HttpMethod.GET,path,null,null,users.get(role).token()),404,"NOT_FOUND");
            byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
            jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",digest(token),replacement,Timestamp.from(Instant.now().plusSeconds(600)));
            try {assertThat(raw(HttpMethod.GET,"/api/my/episodes/"+id+"/pages/2/image",null,null,token).getBody()).isEqualTo(png());}finally{jdbc.update("DELETE FROM auth_token WHERE token_hash=?",digest(token));}
        }
    }
    @Test void auditFailureRollsBackNewAndReplacementImagesAndDatabaseFailureIsSafe() {
        String id=create();doThrow(new DataAccessResourceFailureException("SECRET audit failure")).when(dao).audit(anyLong(),anyLong(),anyInt(),any());error(save(id,png(),"image/png"),503,"SERVICE_UNAVAILABLE");assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM source_page_image WHERE episode_id=?",Long.class,id)).isZero();assertThat(audit(id)).isZero();
        reset(dao);save(id,png(),"image/png");var before=jdbc.queryForMap("SELECT * FROM source_page_image WHERE episode_id=?",id);
        doThrow(new DataAccessResourceFailureException("SECRET audit failure")).when(dao).audit(anyLong(),anyLong(),anyInt(),any());error(save(id,jpeg(),"image/jpeg"),503,"SERVICE_UNAVAILABLE");var after=jdbc.queryForMap("SELECT * FROM source_page_image WHERE episode_id=?",id);assertThat(after.remove("image_data")).isEqualTo(before.remove("image_data"));assertThat(after).isEqualTo(before);assertThat(audit(id)).isEqualTo(1);
        reset(dao);doThrow(new DataAccessResourceFailureException("SECRET read failure")).when(dao).list(anyLong());error(raw(HttpMethod.GET,"/api/episodes/"+id+"/pages",null,null,users.get(Role.OPERATOR).token()),503,"SERVICE_UNAVAILABLE");
    }
    @Test void concurrentReplacementSerializesAndLastStoredTimestampMatchesSuccessfulResponse() throws Exception {
        String id=create();save(id,png(),"image/png");var pool=Executors.newFixedThreadPool(2);var start=new CountDownLatch(1);
        try {
            var a=pool.submit(()->{start.await();return save(id,jpeg(),"image/jpeg");});var b=pool.submit(()->{start.await();return save(id,webp(),"image/webp");});start.countDown();var first=a.get(15,TimeUnit.SECONDS);var second=b.get(15,TimeUnit.SECONDS);assertThat(first.getStatusCode().value()).isEqualTo(200);assertThat(second.getStatusCode().value()).isEqualTo(200);
            var last=Instant.parse(json(first).path("updatedAt").asText()).isAfter(Instant.parse(json(second).path("updatedAt").asText()))?first:second;var metadata=get("/api/episodes/"+id+"/pages").getBody().path("items").get(0);assertThat(metadata).isEqualTo(json(last));var read=raw(HttpMethod.GET,image(id,"2"),null,null,users.get(Role.OPERATOR).token());assertThat(read.getBody()).isEqualTo(metadata.path("contentType").asText().equals("image/jpeg")?jpeg():webp());assertThat(audit(id)).isEqualTo(3);
        }finally{pool.shutdownNow();}
    }
    @Test void publicPublishedResponsesNeverExposeImageOrImageExistence() {
        String id=create();save(id,png(),"image/png");
        jdbc.update("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at) VALUES (?,1,1,'PUBLISHED',?,UTC_TIMESTAMP(6))",id,users.get(Role.TRANSLATOR).id());long version=jdbc.queryForObject("SELECT id FROM translation_version WHERE episode_id=?",Long.class,id);
        jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,1,1,'public text')",version,id);
        jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,1,?,UTC_TIMESTAMP(6))",id,version,users.get(Role.OPERATOR).id());jdbc.update("UPDATE episode SET published_translation_version_id=? WHERE id=?",version,id);
        var response=publicGet(id);assertThat(response.getStatusCode().value()).isEqualTo(200);assertThat(response.getBody().fieldNames()).toIterable().containsExactlyInAnyOrder("episodeId","title","publishedAt","blocks");assertThat(response.getBody().toString()).doesNotContain("image","SECRET_SOURCE","uploadedBy","byteSize");
        for(var block:response.getBody().path("blocks")) assertThat(block.fieldNames()).toIterable().containsExactlyInAnyOrder("seq","pageNo","text");
        assertThat(raw(HttpMethod.GET,"/api/public/episodes/"+id+"/pages/2/image",null,null,null).getStatusCode().value()).isEqualTo(404);
    }
    private void violation(String sql,int expected,Object...args) {
        assertThatThrownBy(()->jdbc.update(sql,args)).isInstanceOfSatisfying(org.springframework.dao.DataAccessException.class,failure->{Throwable cause=failure;while(cause!=null&&!(cause instanceof java.sql.SQLException)) cause=cause.getCause();assertThat(cause).isInstanceOf(java.sql.SQLException.class);assertThat(((java.sql.SQLException)cause).getErrorCode()).isEqualTo(expected);});
    }
    @Test void realSchemaEnforcesNotNullCheckPrimaryAndForeignKeys() {
        String id=create();long actor=users.get(Role.OPERATOR).id();
        String sql="INSERT INTO source_page_image(episode_id,page_no,content_type,byte_size,image_data,uploaded_by,updated_at) VALUES (?,?,?,?,?,?,?)";
        Object[] valid={Long.parseLong(id),2,"image/png",png().length,png(),actor,Timestamp.from(Instant.now())};
        for(int i=0;i<valid.length;i++){var values=valid.clone();values[i]=null;violation(sql,1048,values);}
        for(var pair:List.of(Map.entry(1,0),Map.entry(1,10000),Map.entry(2,"image/gif"),Map.entry(3,0),Map.entry(3,5242881))) {var values=valid.clone();values[pair.getKey()]=pair.getValue();violation(sql,3819,values);}
        var bad=valid.clone();bad[0]=999999999999999999L;violation(sql,1452,bad);bad=valid.clone();bad[5]=999999999999999999L;violation(sql,1452,bad);
        assertThat(jdbc.update(sql,valid)).isEqualTo(1);violation(sql,1062,valid);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='source_page_image' AND IS_NULLABLE='NO'",Integer.class)).isEqualTo(7);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='source_page_image' AND UPDATE_RULE='RESTRICT' AND DELETE_RULE='RESTRICT'",Integer.class)).isEqualTo(2);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='source_page_image' AND COLUMN_NAME='content_type' AND CHARACTER_SET_NAME='ascii' AND COLLATION_NAME='ascii_bin'",Integer.class)).isEqualTo(1);
    }
}
