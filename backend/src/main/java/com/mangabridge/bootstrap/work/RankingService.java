package com.mangabridge.bootstrap.work;
import java.time.*;
import java.util.*;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class RankingService {
 private final CatalogDao catalog;private final CatalogService summaries;private final RankingDao dao;private final Clock clock;private final TransactionTemplate read;
 public RankingService(CatalogDao catalog,CatalogService summaries,RankingDao dao,Clock clock,PlatformTransactionManager manager){this.catalog=catalog;this.summaries=summaries;this.dao=dao;this.clock=clock;read=new TransactionTemplate(manager);read.setReadOnly(true);}
 record Score(CatalogDao.Summary summary,long views,long recommends){long score(){return Math.addExact(views,Math.multiplyExact(recommends,10));}}
 public Map<String,Object> rankings(Map<String,List<String>> query){var q=new LinkedHashMap<>(query);q.putIfAbsent("limit",List.of("10"));int limit=WorkService.page(q,Set.of("period","limit"),50).limit();String period=query.containsKey("period")?query.get("period").get(0):"";int days=switch(period){case "week"->7;case "month"->30;case "year"->365;default->throw WorkFailure.invalid();};LocalDate today=LocalDate.ofInstant(clock.instant(),ZoneOffset.UTC),from=today.minusDays(days-1);try{return read.execute(status->{var scores=catalog.summaries().stream().map(s->new Score(s,dao.views(s.id(),from,today),dao.recommends(s.id(),from,today))).filter(s->s.score()>0).sorted(Comparator.comparingLong(Score::score).reversed().thenComparing(s->s.summary().latest(),Comparator.reverseOrder()).thenComparing(s->s.summary().id(),Comparator.reverseOrder())).limit(limit).toList();var items=new ArrayList<Map<String,Object>>();for(var s:scores){var item=new LinkedHashMap<>(summaries.summary(s.summary()));item.put("rank",items.size()+1);item.put("score",s.score());item.put("periodViews",s.views());item.put("periodRecommends",s.recommends());items.add(item);}return Map.of("period",period,"items",items);});}catch(DataAccessException|TransactionException failure){throw WorkFailure.unavailable();}}
}
