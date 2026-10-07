package com.mangabridge.bootstrap.publication;

import static com.mangabridge.bootstrap.publication.PublicationModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.translation.TranslationDao;
import java.math.BigInteger;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class PublicationService {
    private final PublicationDao dao;
    private final EpisodeDao episodes;
    private final TranslationDao translations;
    private final Clock clock;
    private final TransactionTemplate read,write;
    public PublicationService(PublicationDao dao,EpisodeDao episodes,TranslationDao translations,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao;this.episodes=episodes;this.translations=translations;this.clock=clock;
        read=new TransactionTemplate(manager);read.setReadOnly(true);write=new TransactionTemplate(manager);
    }
    public Published publishTranslation(CurrentUser actor,String id,String number) {
        long episode=path(id,false);int version=(int)path(number,true);
        return execute(write,()->{
            var row=episodes.episode(episode,true);
            if(row==null) throw PublicationFailure.notFound();
            var target=translations.version(episode,version);
            if(target==null) throw PublicationFailure.notFound();
            if(!target.status().equals("APPROVED") || target.sourceVersion()!=row.latest() || !dao.validApproval(target.id(),target.sourceVersion()))
                throw PublicationFailure.state(target.status());
            var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            long account=Long.parseLong(actor.user().id());
            dao.publish(episode,target.id(),target.sourceVersion(),account,now);
            dao.audit(account,episode,target.sourceVersion(),target.id(),now);
            return new Published(version,"PUBLISHED",now);
        });
    }
    public Held holdPublication(CurrentUser actor,String id) {
        long episode=path(id,false);
        return execute(write,()->{
            if(episodes.episode(episode,true)==null) throw PublicationFailure.notFound();
            var target=dao.pointer(episode);
            if(target==null || !target.status().equals("PUBLISHED")) throw PublicationFailure.state(target==null?null:target.status());
            var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            dao.hold(target.id());
            dao.lifecycleAudit(Long.parseLong(actor.user().id()),"PUBLICATION_HELD",episode,target.sourceVersion(),target.id(),now);
            return new Held(target.versionNo(),"ON_HOLD",now);
        });
    }
    public Published resumePublication(CurrentUser actor,String id) {
        long episode=path(id,false);
        return execute(write,()->{
            if(episodes.episode(episode,true)==null) throw PublicationFailure.notFound();
            var target=dao.pointer(episode);
            if(target==null || !target.status().equals("ON_HOLD")) throw PublicationFailure.state(target==null?null:target.status());
            var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            long account=Long.parseLong(actor.user().id());
            dao.resume(episode,target.id(),target.sourceVersion(),account,now);
            dao.lifecycleAudit(account,"PUBLICATION_RESUMED",episode,target.sourceVersion(),target.id(),now);
            return new Published(target.versionNo(),"PUBLISHED",now);
        });
    }
    public Publication getPublication(String id) {
        long episode=path(id,false);
        return execute(read,()->{
            if(episodes.episode(episode,false)==null) throw PublicationFailure.notFound();
            return dao.publication(episode);
        });
    }
    public Episodes listPublicEpisodes(String limit,String offset) {
        BigInteger size=number(limit),start=number(offset);
        if(size.signum()<1 || size.compareTo(BigInteger.valueOf(100))>0) throw PublicationFailure.invalid();
        return execute(read,()->{
            long total=dao.count();
            return new Episodes(start.compareTo(BigInteger.valueOf(total))>=0?List.of():dao.episodes(size.intValue(),start.longValueExact()),total);
        });
    }
    public Detail getPublicEpisode(String id) {
        long episode=path(id,false);
        return execute(read,()->{var result=dao.detail(episode);if(result==null) throw PublicationFailure.notFound();return result;});
    }
    private <T> T execute(TransactionTemplate tx,Supplier<T> action) {
        try { return tx.execute(status->action.get()); }
        catch(DataAccessException | TransactionException failure) { throw PublicationFailure.unavailable(); }
    }
    private static long path(String value,boolean version) {
        if(value==null || !value.matches(version?"^[1-9][0-9]{0,8}$":"^[1-9][0-9]{0,17}$")) throw PublicationFailure.notFound();
        return Long.parseLong(value);
    }
    private static BigInteger number(String value) {
        if(value==null || !value.matches("[0-9]+")) throw PublicationFailure.invalid();return new BigInteger(value);
    }
}
