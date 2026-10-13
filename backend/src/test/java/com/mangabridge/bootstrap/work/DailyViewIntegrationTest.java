package com.mangabridge.bootstrap.work;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.MangabridgeApplication;
import com.mangabridge.bootstrap.auth.AuthModels.Role;
import com.mangabridge.bootstrap.auth.TrackingAuthDao;
import com.mangabridge.bootstrap.config.RequiredEnvironment;
import java.sql.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.*;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.annotation.*;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.http.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.test.context.*;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
@SpringBootTest(classes=MangabridgeApplication.class,webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT)
@ContextConfiguration(initializers=RequiredEnvironment.class)
@ActiveProfiles("local")
@Import(DailyViewIntegrationTest.Fixtures.class)
class DailyViewIntegrationTest {
 @Autowired TestRestTemplate http;@Autowired JdbcTemplate jdbc;@Autowired TrackingAuthDao tracking;
 @MockitoSpyBean java.time.Clock clock; @MockitoSpyBean WorkDao dao;@MockitoSpyBean ViewDao views;
 @org.springframework.boot.test.web.server.LocalServerPort int port;
 final Map<Role,Identity> users=new EnumMap<>(Role.class);final Set<String> works=new HashSet<>(),episodes=new HashSet<>();
 record Identity(long id,String token) { }
 @TestConfiguration static class Fixtures {@Bean @Primary TrackingAuthDao workTrackingAuthDao(JdbcTemplate jdbc){return new TrackingAuthDao(jdbc);}}
 @BeforeEach void setup(){for(Role role:Role.values()){var key=new GeneratedKeyHolder();jdbc.update(c->{var ps=c.prepareStatement("INSERT INTO demo_account(login_id,display_name,role,password_hash) VALUES (?,?,?,?)",Statement.RETURN_GENERATED_KEYS);ps.setString(1,"test.work."+UUID.randomUUID());ps.setString(2,"work fixture");ps.setString(3,role.name());ps.setString(4,"unused-test-hash");return ps;},key);long id=key.getKey().longValue();byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);users.put(role,new Identity(id,token));jdbc.update("INSERT INTO auth_token(token_hash,account_id,expires_at) VALUES (?,?,?)",digest(token),id,Timestamp.from(Instant.now().plusSeconds(3600)));}}
 static byte[] digest(String token){try{return java.security.MessageDigest.getInstance("SHA-256").digest(token.getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception e){throw new AssertionError(e);}}
 @AfterEach void cleanup(){reset(dao,views,clock);tracking.cleanupAudits();for(String id:episodes){jdbc.update("DELETE FROM work_episode WHERE episode_id=?",id);jdbc.update("DELETE FROM episode_view_daily WHERE episode_id=?",id);jdbc.update("DELETE FROM episode_view_count WHERE episode_id=?",id);jdbc.update("UPDATE episode SET published_translation_version_id=NULL WHERE id=?",id);jdbc.update("DELETE FROM publication WHERE episode_id=?",id);jdbc.update("DELETE FROM review_decision WHERE translation_version_id IN (SELECT id FROM translation_version WHERE episode_id=?)",id);jdbc.update("DELETE FROM translation_block WHERE episode_id=?",id);jdbc.update("DELETE FROM translation_version WHERE episode_id=?",id);jdbc.update("DELETE FROM episode_assignment WHERE episode_id=?",id);jdbc.update("DELETE FROM source_block WHERE episode_id=?",id);jdbc.update("DELETE FROM episode_source_version WHERE episode_id=?",id);jdbc.update("DELETE FROM domain_audit WHERE episode_id=?",id);jdbc.update("DELETE FROM episode WHERE id=?",id);}for(String id:works){jdbc.update("DELETE FROM work_recommend WHERE work_id=?",id);jdbc.update("DELETE FROM work_episode WHERE work_id=?",id);jdbc.update("DELETE FROM work_cover WHERE work_id=?",id);jdbc.update("DELETE FROM work_genre WHERE work_id=?",id);jdbc.update("DELETE FROM work WHERE id=?",id);}for(var u:users.values()){jdbc.update("DELETE FROM auth_token WHERE account_id=?",u.id());jdbc.update("DELETE FROM auth_audit WHERE account_id=?",u.id());jdbc.update("DELETE FROM demo_account WHERE id=?",u.id());}}
 ResponseEntity<JsonNode> call(HttpMethod method,String path,Object body,String token){var headers=new HttpHeaders();headers.setContentType(MediaType.APPLICATION_JSON);if(token!=null)headers.setBearerAuth(token);return http.exchange(path,method,new HttpEntity<>(body,headers),JsonNode.class);}
 String token(Role role){return users.get(role).token();}
 ResponseEntity<JsonNode> op(HttpMethod method,String path,Object body){return call(method,path,body,token(Role.OPERATOR));}
 ResponseEntity<JsonNode> get(String path){return op(HttpMethod.GET,path,null);}
 Map<String,Object> values(){var v=new LinkedHashMap<String,Object>();v.put("title","  title  ");v.put("author"," author ");v.put("description","intro\nsecond line");v.put("readingDirection","RTL");v.put("genres",List.of("판타지","액션"));return v;}
 String work(){var response=op(HttpMethod.POST,"/api/works",values());assertThat(response.getStatusCode().value()).isEqualTo(201);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");assertThat(fields(response.getBody())).containsExactlyInAnyOrder("id","revision");String id=response.getBody().path("id").textValue();works.add(id);assertThat(response.getBody().path("revision").intValue()).isEqualTo(1);return id;}
 Map<String,Object> update(int revision){var v=values();v.put("expectedRevision",revision);v.put("isPublic",true);v.put("isFeatured",false);v.put("isBanner",false);return v;}
 String episode(){var response=op(HttpMethod.POST,"/api/episodes",Map.of("title","episode"));assertThat(response.getStatusCode().value()).isEqualTo(201);String id=response.getBody().path("id").textValue();episodes.add(id);return id;}
 static List<String> fields(JsonNode node){var result=new ArrayList<String>();node.fieldNames().forEachRemaining(result::add);return result;}
 void error(ResponseEntity<?> response,int status,String code){assertThat(response.getStatusCode().value()).isEqualTo(status);assertThat(response.getHeaders().getCacheControl()).isEqualTo("no-store");String body=response.getBody() instanceof byte[] b?new String(b,java.nio.charset.StandardCharsets.UTF_8):String.valueOf(response.getBody());assertThat(body).contains("\"error\"","\"code\"","\"message\"",code).doesNotContain("Exception","jdbc:","unused-test-hash","SQLState","image_data","SECRET DB detail","PRIVATE DB FAILURE");}
 byte[] png(){return new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2};}
 byte[] jpeg(){return new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff,1};}
 byte[] webp(){return new byte[]{'R','I','F','F',4,0,0,0,'W','E','B','P',1};}
 ResponseEntity<byte[]> cover(HttpMethod method,String id,byte[] bytes,String type,String token){var headers=new HttpHeaders();if(type!=null)headers.set("Content-Type",type);if(token!=null)headers.setBearerAuth(token);return http.exchange("/api/works/"+id+"/cover",method,new HttpEntity<>(bytes,headers),byte[].class);}
 void png(String id){assertThat(cover(HttpMethod.PUT,id,png(),"image/png",token(Role.OPERATOR)).getStatusCode().value()).isEqualTo(201);}

 String publicEpisode(String work,int no,int seq){String e=episode();op(HttpMethod.PUT,"/api/episodes/"+e+"/work",Map.of("workId",work,"episodeNo",no));long actor=users.get(Role.OPERATOR).id();jdbc.update("INSERT INTO episode_source_version(episode_id,version_no,created_by,created_at,block_count) VALUES (?,1,?,UTC_TIMESTAMP(6),1)",e,actor);jdbc.update("INSERT INTO source_block(episode_id,version_no,seq,page_no,body) VALUES (?,1,1,1,'PRIVATE_SOURCE')",e);jdbc.update("UPDATE episode SET latest_source_version=1 WHERE id=?",e);var key=new GeneratedKeyHolder();jdbc.update(c->{var ps=c.prepareStatement("INSERT INTO translation_version(episode_id,version_no,source_version_no,status,created_by,created_at,draft_revision) VALUES (?,1,1,'PUBLISHED',?,UTC_TIMESTAMP(6),1)",Statement.RETURN_GENERATED_KEYS);ps.setString(1,e);ps.setLong(2,actor);return ps;},key);long v=key.getKey().longValue();jdbc.update("INSERT INTO translation_block(translation_version_id,episode_id,source_version_no,source_seq,body) VALUES (?,?,1,1,'public text')",v,e);jdbc.update("INSERT INTO publication(episode_id,translation_version_id,source_version_no,published_by,published_at) VALUES (?,?,1,?,?)",e,v,actor,Timestamp.from(Instant.parse("2026-10-09T00:00:00Z").plusSeconds(seq)));jdbc.update("UPDATE episode SET published_translation_version_id=? WHERE id=?",v,e);return e;}
 void makePublic(String id){var body=update(1);assertThat(op(HttpMethod.PUT,"/api/works/"+id,body).getStatusCode().value()).isEqualTo(200);}
 @Test void dailyIncrementUtcRolloverAndTwoTableRollback(){
  String w=work();makePublic(w);String e=publicEpisode(w,1,1);
  Instant time=Instant.parse("2026-10-13T23:59:59Z");doReturn(time).when(clock).instant();
  for(int i=0;i<2;i++)assertThat(call(HttpMethod.POST,"/api/public/episodes/"+e+"/views",null,null).getStatusCode().value()).isEqualTo(204);
  assertThat(jdbc.queryForObject("SELECT view_count FROM episode_view_daily WHERE episode_id=? AND view_date='2026-10-13'",Long.class,e)).isEqualTo(2);
  doReturn(time.plusSeconds(1)).when(clock).instant();assertThat(call(HttpMethod.POST,"/api/public/episodes/"+e+"/views",null,null).getStatusCode().value()).isEqualTo(204);
  assertThat(jdbc.queryForObject("SELECT view_count FROM episode_view_count WHERE episode_id=?",Long.class,e)).isEqualTo(3);
  assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM episode_view_daily WHERE episode_id=?",Long.class,e)).isEqualTo(2);
  doThrow(new DataAccessResourceFailureException("SECRET")).when(views).incrementDaily(eq(Long.parseLong(e)),any());
  error(call(HttpMethod.POST,"/api/public/episodes/"+e+"/views",null,null),503,"SERVICE_UNAVAILABLE");
  assertThat(jdbc.queryForObject("SELECT view_count FROM episode_view_count WHERE episode_id=?",Long.class,e)).isEqualTo(3);
  assertThat(jdbc.queryForObject("SELECT SUM(view_count) FROM episode_view_daily WHERE episode_id=?",Long.class,e)).isEqualTo(3);
  reset(views);doThrow(new DataAccessResourceFailureException("SECRET")).when(views).increment(Long.parseLong(e));
  error(call(HttpMethod.POST,"/api/public/episodes/"+e+"/views",null,null),503,"SERVICE_UNAVAILABLE");
  assertThat(jdbc.queryForObject("SELECT SUM(view_count) FROM episode_view_daily WHERE episode_id=?",Long.class,e)).isEqualTo(3);
 }
 @Test void unpublishedAndHeldHaveNoDailyRows(){String w=work();makePublic(w);String e=publicEpisode(w,1,1),none=episode();assertThat(op(HttpMethod.POST,"/api/episodes/"+e+"/publication/hold",null).getStatusCode().value()).isEqualTo(200);for(String id:List.of(e,none,"999999"))error(call(HttpMethod.POST,"/api/public/episodes/"+id+"/views",null,null),404,"NOT_FOUND");assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM episode_view_daily",Long.class)).isZero();}
}
