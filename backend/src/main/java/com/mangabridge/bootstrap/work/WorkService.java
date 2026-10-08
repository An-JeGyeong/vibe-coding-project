package com.mangabridge.bootstrap.work;
import static com.mangabridge.bootstrap.work.WorkModels.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.page.PageModels.Image;
import java.math.BigInteger;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.dao.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class WorkService {
 public static final List<String> GENRES=List.of("판타지","액션","로맨스","코미디","일상","미스터리","스릴러","SF","스포츠","드라마");
 public static final int MAX_BYTES=5242880;
 private final WorkDao dao;private final EpisodeDao episodes;private final Clock clock;private final TransactionTemplate read,write;
 public WorkService(WorkDao dao,EpisodeDao episodes,Clock clock,PlatformTransactionManager manager){this.dao=dao;this.episodes=episodes;this.clock=clock;read=new TransactionTemplate(manager);read.setReadOnly(true);write=new TransactionTemplate(manager);}
 public Map<String,Object> createWork(Create request,CurrentUser actor){Values v=values(request.title(),request.author(),request.description(),request.readingDirection(),request.genres(),false,false,false,true);return tx(write,()->Map.of("id",Long.toString(dao.create(v,Long.parseLong(actor.user().id()),now())),"revision",1));}
 public Map<String,Object> updateWork(String path,Update request){long id=path(path);int expected=integer(request.expectedRevision(),1,Integer.MAX_VALUE);Values v=values(request.title(),request.author(),request.description(),request.readingDirection(),request.genres(),bool(request.isPublic()),bool(request.isFeatured()),bool(request.isBanner()),false);return tx(write,()->{dao.lockWorks();Row row=require(id,false);if(row.revision()!=expected)throw WorkFailure.revision(row.revision());if(same(row,v)&&dao.genres(id).equals(v.genres()))return Map.of("revision",expected,"changed",false);if(v.banner()){if(!dao.hasCover(id))throw WorkFailure.state("COVER_REQUIRED");if(!row.banner()&&dao.banners()>=5)throw WorkFailure.state("BANNER_LIMIT");}dao.update(id,v,expected+1,now());return Map.of("revision",expected+1,"changed",true);});}
 public Map<String,Object> listWorks(Map<String,List<String>> query){var page=page(query,Set.of("limit","offset"),100);return tx(read,()->{long total=dao.count();return Map.of("items",page.offset().compareTo(BigInteger.valueOf(total))>=0?List.of():dao.ids(page.limit(),page.offset().longValueExact()).stream().map(id->item(require(id,false))).toList(),"total",total);});}
 public Map<String,Object> getWork(String path){long id=path(path);return tx(read,()->{Row row=require(id,false);var result=item(row);result.put("description",row.description());result.put("episodes",dao.episodeItems(id));return result;});}
 private LinkedHashMap<String,Object> item(Row row){var result=new LinkedHashMap<String,Object>();result.put("id",Long.toString(row.id()));result.put("title",row.title());result.put("author",row.author());result.put("readingDirection",row.direction());result.put("genres",dao.genres(row.id()));result.put("isPublic",row.isPublic());result.put("isFeatured",row.featured());result.put("isBanner",row.banner());result.put("hasCover",dao.hasCover(row.id()));result.put("episodeCount",dao.episodes(row.id(),false));result.put("publicEpisodeCount",dao.episodes(row.id(),true));result.put("revision",row.revision());result.put("updatedAt",row.updatedAt());return result;}
 public CoverSaved saveWorkCover(String path,String type,byte[] bytes,CurrentUser actor){long id=path(path);validateImage(type,bytes);return tx(write,()->{require(id,true);boolean existed=dao.hasCover(id);var now=now();dao.cover(id,type,bytes,Long.parseLong(actor.user().id()),now);return new CoverSaved(existed?200:201,new CoverMetadata(type,bytes.length,now));});}
 public Image getWorkCover(String path){long id=path(path);return tx(read,()->{require(id,false);var image=dao.cover(id);if(image==null)throw WorkFailure.missing();return image;});}
 public Map<String,Object> assignEpisodeWork(String episodePath,Link request){long episode=path(episodePath);if(request.workId()==null||!request.workId().isTextual())throw WorkFailure.invalid();String raw=request.workId().textValue();if(!raw.matches("^[1-9][0-9]{0,17}$"))throw WorkFailure.invalid();long work=Long.parseLong(raw);int no=integer(request.episodeNo(),1,9999);return tx(write,()->{requireEpisode(episode,true);require(work,true);if(dao.numberTaken(work,no,episode))throw WorkFailure.state("EPISODE_NO_TAKEN");try{dao.link(episode,work,no);}catch(DuplicateKeyException conflict){throw WorkFailure.state("EPISODE_NO_TAKEN");}return Map.of("workId",raw,"episodeNo",no);});}
 public void unassign(String path){long episode=path(path);tx(write,()->{requireEpisode(episode,true);dao.unlink(episode);return null;});}
 public Map<String,Object> getEpisodeWork(String path){long episode=path(path);return tx(read,()->{requireEpisode(episode,false);var result=new LinkedHashMap<String,Object>();result.put("work",dao.link(episode));return result;});}
 private Row require(long id,boolean lock){var row=dao.row(id,lock);if(row==null)throw WorkFailure.missing();return row;}
 private void requireEpisode(long id,boolean lock){if(episodes.episode(id,lock)==null)throw WorkFailure.missing();}
 private java.time.Instant now(){return clock.instant().truncatedTo(ChronoUnit.MICROS);}
 static long path(String path){if(path==null||!path.matches("^[1-9][0-9]{0,17}$"))throw WorkFailure.missing();return Long.parseLong(path);}
 private static String string(JsonNode node){if(node==null||!node.isTextual())throw WorkFailure.invalid();return node.textValue();}
 private static Values values(JsonNode title,JsonNode author,JsonNode description,JsonNode direction,JsonNode genres,boolean pub,boolean featured,boolean banner,boolean creating){String t=string(title).strip(),a=string(author).strip(),d=string(description),rd=direction==null&&creating?"RTL":string(direction);if(length(t)<1||length(t)>100||length(a)<1||length(a)>100||length(d)>2000||d.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\n'&&c!='\r')||!Set.of("RTL","LTR").contains(rd))throw WorkFailure.invalid();if(genres==null||!genres.isArray()||genres.size()<1||genres.size()>3)throw WorkFailure.invalid();var values=new TreeSet<String>();for(JsonNode genre:genres){String g=string(genre);if(!GENRES.contains(g)||!values.add(g))throw WorkFailure.invalid();}return new Values(t,a,d,rd,List.copyOf(values),pub,featured,banner);}
 private static int length(String value){return value.codePointCount(0,value.length());}
 private static boolean same(Row row,Values v){return row.title().equals(v.title())&&row.author().equals(v.author())&&row.description().equals(v.description())&&row.direction().equals(v.direction())&&row.isPublic()==v.isPublic()&&row.featured()==v.featured()&&row.banner()==v.banner();}
 private static boolean bool(JsonNode node){if(node==null||!node.isBoolean())throw WorkFailure.invalid();return node.booleanValue();}
 static int integer(JsonNode node,int min,int max){if(node==null||!node.isIntegralNumber()||!node.canConvertToInt()||node.intValue()<min||node.intValue()>max)throw WorkFailure.invalid();return node.intValue();}
 record Page(int limit,BigInteger offset) { }
 static Page page(Map<String,List<String>> query,Set<String> keys,int max){for(var e:query.entrySet())if(!keys.contains(e.getKey())||e.getValue().size()!=1)throw WorkFailure.invalid();String limit=query.containsKey("limit")?query.get("limit").get(0):"20",offset=query.containsKey("offset")?query.get("offset").get(0):"0";if(!limit.matches("^[0-9]+$")||!offset.matches("^[0-9]+$"))throw WorkFailure.invalid();var n=new BigInteger(limit);if(n.signum()<1||n.compareTo(BigInteger.valueOf(max))>0)throw WorkFailure.invalid();return new Page(n.intValue(),new BigInteger(offset));}
 static void validateImage(String type,byte[] bytes){if(!Set.of("image/png","image/jpeg","image/webp").contains(type==null?"":type)||bytes==null||bytes.length==0||bytes.length>MAX_BYTES)throw WorkFailure.invalid();boolean valid=switch(type){case "image/png"->starts(bytes,new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a},0);case "image/jpeg"->starts(bytes,new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff},0);case "image/webp"->starts(bytes,new byte[]{'R','I','F','F'},0)&&starts(bytes,new byte[]{'W','E','B','P'},8);default->false;};if(!valid)throw WorkFailure.invalid();}
 private static boolean starts(byte[] bytes,byte[] signature,int offset){if(bytes.length<offset+signature.length)return false;for(int i=0;i<signature.length;i++)if(bytes[offset+i]!=signature[i])return false;return true;}
 private static <T>T tx(TransactionTemplate tx,Supplier<T> work){try{return tx.execute(status->work.get());}catch(DataAccessException|TransactionException failure){throw WorkFailure.unavailable();}}
}
