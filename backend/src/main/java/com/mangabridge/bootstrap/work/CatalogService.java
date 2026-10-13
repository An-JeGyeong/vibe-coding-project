package com.mangabridge.bootstrap.work;
import com.mangabridge.bootstrap.page.PageModels.Image;
import java.math.BigInteger;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class CatalogService {
 private final CatalogDao dao;private final WorkDao works;private final TransactionTemplate read;
 public CatalogService(CatalogDao dao,WorkDao works,PlatformTransactionManager manager){this.dao=dao;this.works=works;read=new TransactionTemplate(manager);read.setReadOnly(true);}
 private static final Comparator<CatalogDao.Summary> LATEST=Comparator.comparing(CatalogDao.Summary::latest).reversed().thenComparing(Comparator.comparingLong(CatalogDao.Summary::id).reversed());
 private static final Comparator<CatalogDao.Summary> POPULAR=Comparator.comparingLong(CatalogDao.Summary::views).reversed().thenComparing(Comparator.comparingLong(CatalogDao.Summary::id).reversed());
 Map<String,Object> summary(CatalogDao.Summary s){return Map.of("workId",Long.toString(s.id()),"title",s.title(),"author",s.author(),"genres",works.genres(s.id()),"hasCover",s.cover(),"episodeCount",s.episodes(),"latestPublishedAt",s.latest(),"views",s.views(),"recommendCount",dao.recommendCount(s.id()));}
 public Map<String,Object> home(){return tx(()->{var all=dao.summaries();var banners=all.stream().filter(s->s.banner()&&s.cover()).sorted(Comparator.comparingLong(CatalogDao.Summary::id).reversed()).limit(5).map(this::summary).toList();var popular=all.stream().sorted(POPULAR).limit(10).map(this::summary).toList();var featured=all.stream().filter(CatalogDao.Summary::featured).sorted(Comparator.comparing(CatalogDao.Summary::updated).reversed().thenComparing(Comparator.comparingLong(CatalogDao.Summary::id).reversed())).limit(10).map(this::summary).toList();return Map.of("banners",banners,"latest",dao.latest(),"popular",popular,"featured",featured);});}
 public Map<String,Object> list(Map<String,List<String>> query){var page=WorkService.page(query,Set.of("genre","sort","limit","offset"),50);String genre=query.containsKey("genre")?query.get("genre").get(0):null,sort=query.containsKey("sort")?query.get("sort").get(0):"latest";if((genre!=null&&!WorkService.GENRES.contains(genre))||!Set.of("latest","popular").contains(sort))throw WorkFailure.invalid();return tx(()->{var all=dao.summaries().stream().filter(s->genre==null||works.genres(s.id()).contains(genre)).sorted(sort.equals("popular")?POPULAR:LATEST).toList();return Map.of("total",all.size(),"items",page.offset().compareTo(BigInteger.valueOf(all.size()))>=0?List.of():all.stream().skip(page.offset().longValueExact()).limit(page.limit()).map(this::summary).toList());});}
 public Map<String,Object> detail(String path){long id=WorkService.path(path);return tx(()->{var s=require(id);var row=works.row(id,false);var result=new LinkedHashMap<>(summary(s));result.put("description",row.description());result.put("readingDirection",row.direction());result.put("episodes",dao.episodes(id));return result;});}
 public Image cover(String path){long id=WorkService.path(path);return tx(()->{require(id);var image=works.cover(id);if(image==null)throw WorkFailure.missing();return image;});}
 public Map<String,Object> episodeWork(String path){long id=WorkService.path(path);return tx(()->{var result=dao.episodeWork(id);if(result==null)throw WorkFailure.missing();return result;});}
 private CatalogDao.Summary require(long id){return dao.summaries().stream().filter(s->s.id()==id).findFirst().orElseThrow(WorkFailure::missing);}
 private <T>T tx(Supplier<T> supplier){try{return read.execute(status->supplier.get());}catch(DataAccessException|TransactionException failure){throw WorkFailure.unavailable();}}
}
