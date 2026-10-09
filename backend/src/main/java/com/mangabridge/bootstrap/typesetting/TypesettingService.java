package com.mangabridge.bootstrap.typesetting;
import com.mangabridge.bootstrap.auth.AuthModels.*;
import com.mangabridge.bootstrap.auth.AuthFailure;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.translation.*;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service public class TypesettingService {
 private final TypesettingDao dao;private final AssignmentDao assignments;private final TranslationDao translations;private final TransactionTemplate read;
 public record Versions(List<TypesettingDao.Item> items){}
 public record Detail(int versionNo,int sourceVersion,List<TranslationModels.Block> blocks){@Override public String toString(){return "TypesettingDetail[redacted]";}}
 public TypesettingService(TypesettingDao dao,AssignmentDao assignments,TranslationDao translations,PlatformTransactionManager manager){this.dao=dao;this.assignments=assignments;this.translations=translations;read=new TransactionTemplate(manager);read.setReadOnly(true);}
 public Versions list(CurrentUser actor,String id){long episode=path(id,18);return execute(()->{require(actor,episode);return new Versions(dao.approved(episode));});}
 public Detail detail(CurrentUser actor,String id,String versionNo){long episode=path(id,18);int number=(int)path(versionNo,9);return execute(()->{require(actor,episode);var version=translations.version(episode,number);if(version==null||!version.status().equals("APPROVED"))throw TypesettingFailure.notFound();return new Detail(number,version.sourceVersion(),translations.blocks(episode,version));});}
 private void require(CurrentUser actor,long episode){if(actor.user().role()!=Role.TYPESETTER)throw TypesettingFailure.forbidden();if(!assignments.assigned(episode,Long.parseLong(actor.user().id()),"TYPESETTER"))throw TypesettingFailure.notFound();}
 private static long path(String value,int digits){if(value==null||!value.matches("^[1-9][0-9]{0,"+(digits-1)+"}$"))throw TypesettingFailure.notFound();return Long.parseLong(value);}
 private <T>T execute(Supplier<T> work){try{return read.execute(s->work.get());}catch(DataAccessException|TransactionException failure){throw TypesettingFailure.unavailable();}}
}
