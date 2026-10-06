package com.mangabridge.bootstrap.translation;

import static com.mangabridge.bootstrap.translation.TranslationModels.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.episode.EpisodeModels;
import java.math.BigInteger;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class TranslationService {
    private final TranslationDao dao;
    private final EpisodeDao episodes;
    private final AssignmentDao assignments;
    private final Clock clock;
    private final TransactionTemplate write,read;
    public TranslationService(TranslationDao dao,EpisodeDao episodes,AssignmentDao assignments,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao; this.episodes=episodes; this.assignments=assignments; this.clock=clock;
        write=new TransactionTemplate(manager); read=new TransactionTemplate(manager); read.setReadOnly(true);
    }
    public Versions listTranslations(CurrentUser actor,String pathId) {
        long episode=path(pathId,false);
        return execute(read,()->{
            var row=assigned(actor,episode,false);
            return new Versions(row.latest(),dao.versions(episode).stream().map(Stored::item).toList());
        });
    }
    public Created createTranslation(CurrentUser actor,String pathId) {
        long episode=path(pathId,false);
        return execute(write,()->{
            var row=assigned(actor,episode,true); var versions=dao.versions(episode);
            if(row.latest()<1 || versions.stream().anyMatch(v->Set.of("DRAFT","REVIEW_PENDING").contains(v.status())))
                throw TranslationFailure.state(null);
            int version=Math.addExact(dao.latestTranslationVersion(episode),1); Instant now=now();
            long id=dao.create(episode,version,row.latest(),actorId(actor),now);
            if(!versions.isEmpty()) dao.copy(episode,row.latest(),versions.get(0).id(),id);
            dao.audit(actorId(actor),"TRANSLATION_CREATED",episode,row.latest(),id,now);
            return new Created(version,"DRAFT",row.latest(),1);
        });
    }
    public Detail getTranslation(CurrentUser actor,String pathId,String pathVersion) {
        long episode=path(pathId,false); int number=(int)path(pathVersion,true);
        return execute(read,()->{
            assigned(actor,episode,false); Stored version=required(episode,number);
            return new Detail(version.versionNo(),version.status(),version.sourceVersion(),version.revision(),version.createdAt(),
                    version.submittedAt(),version.status().equals("DRAFT"),dao.blocks(episode,version));
        });
    }
    public Saved saveTranslationDraft(CurrentUser actor,String pathId,String pathVersion,SaveRequest request) {
        long episode=path(pathId,false); int number=(int)path(pathVersion,true);
        BigInteger expected=revision(request==null?null:request.expectedRevision());
        if(request.blocks()==null) throw TranslationFailure.invalid();
        var texts=new TreeMap<Integer,String>();
        for(BlockRequest block:request.blocks()) {
            if(block==null || block.seq()==null || !block.seq().isIntegralNumber() || !block.seq().canConvertToInt()
                    || block.seq().intValue()<1) throw TranslationFailure.invalid();
            if(texts.putIfAbsent(block.seq().intValue(),text(block.text()))!=null) throw TranslationFailure.invalid();
        }
        return execute(write,()->{
            assigned(actor,episode,true); Stored version=required(episode,number); draft(version,expected);
            var sourceSeqs=dao.blocks(episode,version).stream().map(Block::seq).toList();
            if(!sourceSeqs.containsAll(texts.keySet())) throw TranslationFailure.invalid();
            if(dao.texts(version.id()).equals(texts)) return new Saved(version.revision(),false);
            dao.replace(episode,version,texts);
            return new Saved(Math.addExact(version.revision(),1),true);
        });
    }
    public Submitted submitTranslation(CurrentUser actor,String pathId,String pathVersion,SubmitRequest request) {
        long episode=path(pathId,false); int number=(int)path(pathVersion,true);
        BigInteger expected=revision(request==null?null:request.expectedRevision());
        return execute(write,()->{
            var row=assigned(actor,episode,true); Stored version=required(episode,number); draft(version,expected);
            if(version.sourceVersion()!=row.latest()) throw TranslationFailure.state(version.status());
            List<Integer> missing=dao.blocks(episode,version).stream().filter(b->blank(b.text())).map(Block::seq).toList();
            if(!missing.isEmpty()) throw TranslationFailure.incomplete(missing);
            Instant now=now(); dao.submit(version.id(),now);
            dao.audit(actorId(actor),"TRANSLATION_SUBMITTED",episode,version.sourceVersion(),version.id(),now);
            return new Submitted(number,"REVIEW_PENDING",now);
        });
    }
    private EpisodeModels.Stored assigned(CurrentUser actor,long episode,boolean lock) {
        var row=episodes.episode(episode,lock);
        if(row==null || !assignments.assigned(episode,actorId(actor),"TRANSLATOR")) throw TranslationFailure.notFound();
        return row;
    }
    private Stored required(long episode,int number) {
        var version=dao.version(episode,number); if(version==null) throw TranslationFailure.notFound(); return version;
    }
    private static void draft(Stored version,BigInteger expected) {
        if(!version.status().equals("DRAFT")) throw TranslationFailure.state(version.status());
        if(!expected.equals(BigInteger.valueOf(version.revision()))) throw TranslationFailure.revision(version.revision());
    }
    private <T> T execute(TransactionTemplate tx,Supplier<T> action) {
        try { return tx.execute(status->action.get()); }
        catch(DataAccessException | TransactionException failure) { throw TranslationFailure.unavailable(); }
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static long actorId(CurrentUser actor) { return Long.parseLong(actor.user().id()); }
    private static long path(String value,boolean version) {
        if(value==null || !value.matches(version?"^[1-9][0-9]{0,8}$":"^[1-9][0-9]{0,17}$")) throw TranslationFailure.notFound();
        return Long.parseLong(value);
    }
    private static BigInteger revision(JsonNode value) {
        if(value==null || !value.isIntegralNumber() || value.bigIntegerValue().signum()<1) throw TranslationFailure.invalid();
        return value.bigIntegerValue();
    }
    private static boolean blank(String value) {
        return value==null || value.codePoints().allMatch(c->Character.isWhitespace(c)||Character.isSpaceChar(c));
    }
    private static String text(JsonNode value) {
        if(value==null || !value.isTextual()) throw TranslationFailure.invalid();
        String result=value.textValue(); int length=result.codePointCount(0,result.length());
        if(length<1 || length>4000 || blank(result) || result.codePoints().anyMatch(c->Character.isISOControl(c) && c!='\t' && c!='\n' && c!='\r'))
            throw TranslationFailure.invalid();
        return result;
    }
}
