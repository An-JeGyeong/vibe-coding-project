package com.mangabridge.bootstrap.translatedpage;

import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.auth.AuthModels.Role;

import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.translation.TranslationDao;
import com.mangabridge.bootstrap.translation.TranslationModels.Stored;
import com.mangabridge.bootstrap.page.PageModels.*;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TranslationPageService {
    public static final int MAX_BYTES=5242880;
    private final TranslationPageDao dao;
    private final EpisodeDao episodes;
    private final AssignmentDao assignments;
    private final TranslationDao translations;
    private final Clock clock;
    private final TransactionTemplate write,read;
    public record PublicPage(int pageNo) { }
    public record PublicPages(List<PublicPage> items) { }
    public TranslationPageService(TranslationPageDao dao,EpisodeDao episodes,AssignmentDao assignments,TranslationDao translations,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao;this.episodes=episodes;this.assignments=assignments;this.translations=translations;this.clock=clock;
        write=new TransactionTemplate(manager);read=new TransactionTemplate(manager);read.setReadOnly(true);
    }
    public Saved saveTranslationPageImage(CurrentUser actor,String id,String versionNo,String pageNo,String type,byte[] bytes) {
        long episode=path(id,18);int version=(int)path(versionNo,9),page=(int)path(pageNo,4);
        if(actor.user().role()!=Role.TRANSLATOR) throw TranslationPageFailure.forbidden();
        validateImage(type,bytes);
        return execute(write,()->{
            if(episodes.episode(episode,true)==null) throw TranslationPageFailure.notFound();
            var stored=require(actor,episode,version,false);
            if(!stored.status().equals("DRAFT")) throw TranslationPageFailure.state(stored.status());
            if(!dao.sourceHasPage(episode,stored.sourceVersion(),page)) throw TranslationPageFailure.notFound();
            boolean existed=dao.exists(stored.id(),page);var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            long account=Long.parseLong(actor.user().id());
            dao.save(stored.id(),page,type,bytes,account,now);dao.audit(account,episode,stored.sourceVersion(),stored.id(),now);
            return new Saved(existed?200:201,new Metadata(page,type,bytes.length,now));
        });
    }
    public Pages list(CurrentUser actor,String id,String versionNo,boolean operator) {
        long episode=path(id,18);int version=(int)path(versionNo,9);
        return execute(read,()->new Pages(dao.list(require(actor,episode,version,operator).id())));
    }
    public Image image(CurrentUser actor,String id,String versionNo,String pageNo,boolean operator) {
        long episode=path(id,18);int version=(int)path(versionNo,9),page=(int)path(pageNo,4);
        return execute(read,()->requireImage(require(actor,episode,version,operator).id(),page));
    }
    private Stored require(CurrentUser actor,long episode,int version,boolean operator) {
        var role=actor.user().role();
        if(operator?role!=Role.OPERATOR:role!=Role.TRANSLATOR&&role!=Role.REVIEWER) throw TranslationPageFailure.forbidden();
        if(!operator&&!assignments.assigned(episode,Long.parseLong(actor.user().id()),role.name())) throw TranslationPageFailure.notFound();
        var stored=translations.version(episode,version);
        if(stored==null||(!operator&&role==Role.REVIEWER&&!Set.of("REVIEW_PENDING","APPROVED","REJECTED").contains(stored.status()))) throw TranslationPageFailure.notFound();
        return stored;
    }
    public PublicPages publicList(String id) {
        long episode=path(id,18);return execute(read,()->new PublicPages(dao.publicPages(publicVersion(episode)).stream().map(PublicPage::new).toList()));
    }
    public Image publicImage(String id,String pageNo) {
        long episode=path(id,18);int page=(int)path(pageNo,4);return execute(read,()->requireImage(publicVersion(episode),page));
    }
    private long publicVersion(long episode) {var version=dao.publicVersion(episode);if(version==null) throw TranslationPageFailure.notFound();return version;}
    private Image requireImage(long version,int page) {var image=dao.image(version,page);if(image==null) throw TranslationPageFailure.notFound();return image;}
    static long path(String value,int digits) {if(value==null||!value.matches("^[1-9][0-9]{0,"+(digits-1)+"}$")) throw TranslationPageFailure.notFound();return Long.parseLong(value);}
    static void validateImage(String type,byte[] bytes) {
        if(!Set.of("image/png","image/jpeg","image/webp").contains(type==null?"":type)||bytes==null||bytes.length==0||bytes.length>MAX_BYTES) throw TranslationPageFailure.invalid();
        boolean valid=switch(type) {
            case "image/png" -> starts(bytes,new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a},0);
            case "image/jpeg" -> starts(bytes,new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff},0);
            case "image/webp" -> starts(bytes,new byte[]{'R','I','F','F'},0)&&starts(bytes,new byte[]{'W','E','B','P'},8);
            default -> false;
        };
        if(!valid) throw TranslationPageFailure.invalid();
    }
    private static boolean starts(byte[] bytes,byte[] signature,int offset) {if(bytes.length<offset+signature.length) return false;for(int i=0;i<signature.length;i++) if(bytes[offset+i]!=signature[i]) return false;return true;}
    private static <T> T execute(TransactionTemplate tx,Supplier<T> work) {try{return tx.execute(status->work.get());}catch(DataAccessException|TransactionException failure){throw TranslationPageFailure.unavailable();}}
}
