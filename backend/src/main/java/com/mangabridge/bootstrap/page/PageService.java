package com.mangabridge.bootstrap.page;

import static com.mangabridge.bootstrap.page.PageModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class PageService {
    public static final int MAX_BYTES=5242880;
    private final PageDao dao;
    private final EpisodeDao episodes;
    private final AssignmentDao assignments;
    private final Clock clock;
    private final TransactionTemplate write,read;
    public PageService(PageDao dao,EpisodeDao episodes,AssignmentDao assignments,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao;this.episodes=episodes;this.assignments=assignments;this.clock=clock;
        write=new TransactionTemplate(manager);read=new TransactionTemplate(manager);read.setReadOnly(true);
    }
    public Saved savePageImage(CurrentUser actor,String pathId,String pathPage,String type,byte[] bytes) {
        long episode=path(pathId,false);int page=(int)path(pathPage,true);
        validateImage(type,bytes);
        return execute(write,()->{
            var row=episodes.episode(episode,true);
            if(row==null||!dao.sourceHasPage(episode,row.latest(),page)) throw PageFailure.notFound();
            boolean existed=dao.exists(episode,page);var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            long account=Long.parseLong(actor.user().id());
            dao.save(episode,page,type,bytes,account,now);dao.audit(account,episode,row.latest(),now);
            return new Saved(existed?200:201,new Metadata(page,type,bytes.length,now));
        });
    }
    public Pages listPageImages(CurrentUser actor,String pathId,boolean assigned) {
        long episode=path(pathId,false);
        return execute(read,()->{require(actor,episode,assigned);return new Pages(dao.list(episode));});
    }
    public Image getPageImage(CurrentUser actor,String pathId,String pathPage,boolean assigned) {
        long episode=path(pathId,false);int page=(int)path(pathPage,true);
        return execute(read,()->{require(actor,episode,assigned);var image=dao.image(episode,page);if(image==null) throw PageFailure.notFound();return image;});
    }
    private void require(CurrentUser actor,long episode,boolean assigned) {
        if(episodes.episode(episode,false)==null || (assigned&&!assignments.assigned(episode,Long.parseLong(actor.user().id()),actor.user().role().name()))) throw PageFailure.notFound();
    }
    static long path(String value,boolean page) {
        if(value==null||!value.matches(page?"^[1-9][0-9]{0,3}$":"^[1-9][0-9]{0,17}$")) throw PageFailure.notFound();return Long.parseLong(value);
    }
    static void validateImage(String type,byte[] bytes) {
        if(!Set.of("image/png","image/jpeg","image/webp").contains(type==null?"":type)||bytes==null||bytes.length==0||bytes.length>MAX_BYTES) throw PageFailure.invalid();
        boolean valid=switch(type) {
            case "image/png" -> starts(bytes,new byte[]{(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a},0);
            case "image/jpeg" -> starts(bytes,new byte[]{(byte)0xff,(byte)0xd8,(byte)0xff},0);
            case "image/webp" -> starts(bytes,new byte[]{'R','I','F','F'},0)&&starts(bytes,new byte[]{'W','E','B','P'},8);
            default -> false;
        };
        if(!valid) throw PageFailure.invalid();
    }
    private static boolean starts(byte[] bytes,byte[] signature,int offset) {
        if(bytes.length<offset+signature.length) return false;for(int i=0;i<signature.length;i++) if(bytes[offset+i]!=signature[i]) return false;return true;
    }
    private static <T> T execute(TransactionTemplate tx,Supplier<T> work) {
        try {return tx.execute(status->work.get());} catch(DataAccessException|TransactionException failure) {throw PageFailure.unavailable();}
    }
}
