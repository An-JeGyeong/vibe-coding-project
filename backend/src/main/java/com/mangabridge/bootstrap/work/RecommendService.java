package com.mangabridge.bootstrap.work;
import com.fasterxml.jackson.databind.JsonNode;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Map;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class RecommendService {
 public record Request(JsonNode voterKey){@Override public String toString(){return "Request[redacted]";}}
 private final RecommendDao dao;private final WorkDao works;private final Clock clock;private final TransactionTemplate write;
 public RecommendService(RecommendDao dao,WorkDao works,Clock clock,PlatformTransactionManager manager){this.dao=dao;this.works=works;this.clock=clock;write=new TransactionTemplate(manager);}
 public Map<String,Object> recommend(String path,Request request,boolean add){return recommend(path,request,add,null);}
 /** With an account the vote is the account's own (one per work, on any device) and the body is ignored; without one it is the anonymous key of the body (CONTRACTS 31.3, 32.5). */
 public Map<String,Object> recommend(String path,Request request,boolean add,Long accountId){long id=WorkService.path(path);String key;if(accountId!=null)key=com.mangabridge.bootstrap.account.MeService.voterKey(accountId);else{JsonNode node=request==null?null:request.voterKey();if(node==null||!node.isTextual()||!node.textValue().matches("^[0-9a-f]{32}$"))throw WorkFailure.invalid();key=node.textValue();}try{return write.execute(status->{if(works.row(id,true)==null||!dao.publishedWork(id))throw WorkFailure.missing();if(add)dao.recommend(id,key,clock.instant().truncatedTo(ChronoUnit.MICROS));else dao.unrecommend(id,key);return Map.of("recommended",add,"recommendCount",dao.count(id));});}catch(DataAccessException|TransactionException failure){throw WorkFailure.unavailable();}}
}
