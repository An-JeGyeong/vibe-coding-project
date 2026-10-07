package com.mangabridge.bootstrap.review;

import static com.mangabridge.bootstrap.review.ReviewModels.*;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.auth.AuthService;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.episode.EpisodeModels;
import com.mangabridge.bootstrap.translation.TranslationDao;
import com.mangabridge.bootstrap.translation.TranslationModels;
import java.math.BigInteger;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Set;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class ReviewService {
    private static final Set<String> VISIBLE=Set.of("REVIEW_PENDING","APPROVED","REJECTED");
    private final ReviewDao dao;
    private final TranslationDao translations;
    private final EpisodeDao episodes;
    private final AssignmentDao assignments;
    private final AuthService auth;
    private final Clock clock;
    private final TransactionTemplate read,write;
    public ReviewService(ReviewDao dao,TranslationDao translations,EpisodeDao episodes,AssignmentDao assignments,
                         AuthService auth,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao; this.translations=translations; this.episodes=episodes; this.assignments=assignments; this.auth=auth; this.clock=clock;
        read=new TransactionTemplate(manager); read.setReadOnly(true); write=new TransactionTemplate(manager);
    }
    public Queue listPendingReviews(CurrentUser actor,String limit,String offset) {
        BigInteger size=number(limit),start=number(offset);
        if(size.signum()<1 || size.compareTo(BigInteger.valueOf(100))>0) throw ReviewFailure.invalid();
        return execute(read,()->{
            long total=dao.count(actorId(actor));
            return new Queue(start.compareTo(BigInteger.valueOf(total))>=0?List.of():dao.pending(actorId(actor),size.intValue(),start.longValueExact()),total);
        });
    }
    public Versions listEpisodeReviews(CurrentUser actor,String id) {
        long episode=path(id,false);
        return execute(read,()->{
            var row=assigned(actor,episode,false);
            return new Versions(row.latest(),translations.versions(episode).stream().filter(v->VISIBLE.contains(v.status()))
                    .map(v->new Item(v.versionNo(),v.status(),v.sourceVersion(),v.submittedAt(),dao.decision(v.id()))).toList());
        });
    }
    public Detail getReview(CurrentUser actor,String id,String number) {
        long episode=path(id,false); int version=(int)path(number,true);
        return execute(read,()->{
            var row=assigned(actor,episode,false); var v=required(episode,version);
            if(!VISIBLE.contains(v.status())) throw ReviewFailure.notFound();
            boolean decidable=v.status().equals("REVIEW_PENDING") && v.sourceVersion()==row.latest() && dao.author(v.id())!=actorId(actor);
            return new Detail(v.versionNo(),v.status(),v.sourceVersion(),v.submittedAt(),decidable,dao.decision(v.id()),translations.blocks(episode,v),translations.blockComments(v.id(),v.status()));
        });
    }
    public Result approveTranslation(CurrentUser actor,String id,String number) { return decide(actor,id,number,"APPROVED",null,List.of()); }
    public Result rejectTranslation(CurrentUser actor,String id,String number,RejectRequest request) {
        if(request==null || request.reason()==null || !request.reason().isTextual()) throw ReviewFailure.invalid();
        String reason=request.reason().textValue(); int length=reason.codePointCount(0,reason.length());
        if(length<1 || length>500 || reason.codePoints().allMatch(c->Character.isWhitespace(c)||Character.isSpaceChar(c))
                || reason.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\t'&&c!='\n'&&c!='\r')) throw ReviewFailure.invalid();
        return decide(actor,id,number,"REJECTED",reason,commentInputs(request.comments()));
    }
    private static List<CommentInput> commentInputs(com.fasterxml.jackson.databind.JsonNode node) {
        if(node==null) return List.of();
        if(!node.isArray() || node.size()>50) throw ReviewFailure.invalid();
        var result=new ArrayList<CommentInput>(); var seqs=new HashSet<Integer>();
        for(var item:node) {
            if(!item.isObject() || item.size()!=2 || !item.has("seq") || !item.has("text")) throw ReviewFailure.invalid();
            var seq=item.get("seq"); var text=item.get("text");
            if(!seq.isIntegralNumber() || !seq.canConvertToInt() || !seqs.add(seq.intValue()) || !text.isTextual()) throw ReviewFailure.invalid();
            String value=text.textValue(); int length=value.codePointCount(0,value.length());
            if(length<1 || length>300 || value.codePoints().allMatch(c->Character.isWhitespace(c)||Character.isSpaceChar(c))
                    || value.codePoints().anyMatch(c->Character.isISOControl(c)&&c!='\t'&&c!='\n'&&c!='\r')) throw ReviewFailure.invalid();
            result.add(new CommentInput(seq.intValue(),value));
        }
        return List.copyOf(result);
    }
    private Result decide(CurrentUser actor,String id,String number,String decision,String reason,List<CommentInput> inputs) {
        long episode=path(id,false); int version=(int)path(number,true);
        try { return execute(write,()->{
            var row=assigned(actor,episode,true); var v=required(episode,version);
            if(!v.status().equals("REVIEW_PENDING") || v.sourceVersion()!=row.latest()) throw ReviewFailure.state(v.status());
            if(dao.author(v.id())==actorId(actor)) throw new SelfReview();
            if(!inputs.isEmpty() && !translations.texts(v.id()).keySet().containsAll(inputs.stream().map(CommentInput::seq).toList())) throw ReviewFailure.invalid();
            var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            dao.decide(v.id(),v.sourceVersion(),actorId(actor),decision,reason,now);
            dao.audit(actorId(actor),decision.equals("APPROVED")?"REVIEW_APPROVED":"REVIEW_REJECTED",episode,v.sourceVersion(),v.id(),now);
            if(!inputs.isEmpty()) {
                long decisionId=dao.decisionId(v.id());
                var stored=dao.commentDecision(decisionId);
                // The two V32 foreign keys do not enforce this relationship; check before any INSERT.
                if(stored==null || stored.versionId()!=v.id() || !stored.decision().equals("REJECTED"))
                    throw new DataIntegrityViolationException("Comment decision mismatch");
                for(var input:inputs) dao.insertComment(decisionId,v.id(),input,now);
            }
            return new Result(version,decision,now);
        }); } catch(SelfReview denied) {
            // Persist the denial after the domain transaction has rolled back.
            auth.accessDenied(actor);
            throw ReviewFailure.forbidden();
        }
    }
    private static class SelfReview extends RuntimeException { }
    public TranslationModels.Versions listTranslationsForOperator(String id) {
        long episode=path(id,false);
        return execute(read,()->{
            var row=requiredEpisode(episode,false);
            return new TranslationModels.Versions(row.latest(),translations.versions(episode).stream()
                    .map(v->new TranslationModels.Item(v.versionNo(),v.status(),v.sourceVersion(),v.revision(),v.createdAt(),v.submittedAt(),dao.decision(v.id()))).toList());
        });
    }
    public OperatorDetail getTranslationForOperator(String id,String number) {
        long episode=path(id,false); int version=(int)path(number,true);
        return execute(read,()->{
            requiredEpisode(episode,false); var v=required(episode,version);
            return new OperatorDetail(v.versionNo(),v.status(),v.sourceVersion(),v.createdAt(),v.submittedAt(),dao.decision(v.id()),dao.invalidatedAt(v.id()),translations.blocks(episode,v),translations.blockComments(v.id(),v.status()));
        });
    }
    private EpisodeModels.Stored requiredEpisode(long episode,boolean lock) {
        var row=episodes.episode(episode,lock); if(row==null) throw ReviewFailure.notFound(); return row;
    }
    private EpisodeModels.Stored assigned(CurrentUser actor,long episode,boolean lock) {
        var row=requiredEpisode(episode,lock);
        if(!assignments.assigned(episode,actorId(actor),"REVIEWER")) throw ReviewFailure.notFound(); return row;
    }
    private TranslationModels.Stored required(long episode,int version) {
        var row=translations.version(episode,version); if(row==null) throw ReviewFailure.notFound(); return row;
    }
    private <T> T execute(TransactionTemplate tx,Supplier<T> action) {
        try { return tx.execute(status->action.get()); }
        catch(DataAccessException | TransactionException failure) { throw ReviewFailure.unavailable(); }
    }
    private static long actorId(CurrentUser actor) { return Long.parseLong(actor.user().id()); }
    private static long path(String value,boolean version) {
        if(value==null || !value.matches(version?"^[1-9][0-9]{0,8}$":"^[1-9][0-9]{0,17}$")) throw ReviewFailure.notFound(); return Long.parseLong(value);
    }
    private static BigInteger number(String value) {
        if(value==null || !value.matches("[0-9]+")) throw ReviewFailure.invalid(); return new BigInteger(value);
    }
}
