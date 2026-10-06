package com.mangabridge.bootstrap.assignment;

import static com.mangabridge.bootstrap.assignment.AssignmentModels.*;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.episode.EpisodeModels.Stored;
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
public class AssignmentService {
    private final AssignmentDao dao;
    private final EpisodeDao episodes;
    private final Clock clock;
    private final TransactionTemplate write,read;
    public AssignmentService(AssignmentDao dao,EpisodeDao episodes,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao; this.episodes=episodes; this.clock=clock;
        write=new TransactionTemplate(manager); read=new TransactionTemplate(manager); read.setReadOnly(true);
    }
    public Candidates listAssignableAccounts(String role) {
        if(!"TRANSLATOR".equals(role) && !"REVIEWER".equals(role)) throw AssignmentFailure.invalid();
        return execute(read,()->new Candidates(dao.candidates(role)));
    }
    public Assignments getAssignments(String pathId) {
        long id=path(pathId);
        return execute(read,()->{ required(id,false); return new Assignments(dao.slot(id,"TRANSLATOR"),dao.slot(id,"REVIEWER")); });
    }
    public SaveResult setAssignment(String pathId,String pathRole,SetRequest request,CurrentUser actor) {
        long id=path(pathId);
        String role=switch(pathRole) { case "translator" -> "TRANSLATOR"; case "reviewer" -> "REVIEWER"; default -> throw AssignmentFailure.notFound(); };
        if(request==null || request.accountId()==null || !request.accountId().isTextual()
                || !request.accountId().textValue().matches("^[1-9][0-9]{0,17}$")) throw AssignmentFailure.invalid();
        long account=Long.parseLong(request.accountId().textValue());
        return execute(write,()->{
            required(id,true);
            Candidate target=dao.eligibleAccount(account,role);
            if(target==null) throw AssignmentFailure.invalid();
            Slot previous=dao.slot(id,role);
            Account responseAccount=new Account(target.id(),target.displayName());
            if(previous!=null && previous.account().id().equals(target.id()))
                return new SaveResult(200,new Result(role,responseAccount,previous.assignedAt(),false));
            var now=clock.instant().truncatedTo(ChronoUnit.MICROS);
            dao.upsert(id,role,account,actorId(actor),now);
            dao.audit(actorId(actor),id,account,now);
            return new SaveResult(previous==null?201:200,new Result(role,responseAccount,now,true));
        });
    }
    public Episodes listMyEpisodes(CurrentUser user,String limit,String offset) {
        BigInteger size=number(limit),start=number(offset);
        if(size.signum()<=0 || size.compareTo(BigInteger.valueOf(100))>0) throw AssignmentFailure.invalid();
        return execute(read,()->{
            long total=dao.countMine(actorId(user),user.user().role().name());
            return new Episodes(start.compareTo(BigInteger.valueOf(total))>=0?List.of():dao.mine(actorId(user),user.user().role().name(),size.intValue(),start.longValueExact()),total);
        });
    }
    public Detail getMyEpisode(CurrentUser user,String pathId) {
        long id=path(pathId);
        return execute(read,()->{
            if(!dao.assigned(id,actorId(user),user.user().role().name())) throw AssignmentFailure.notFound();
            Stored row=required(id,false);
            var source=row.latest()==0?null:episodes.source(id,row.latest());
            return new Detail(Long.toString(id),row.title(),user.user().role().name(),row.latest(),
                    source==null?null:new Source(source.version(),source.savedAt(),source.blocks()));
        });
    }
    private Stored required(long id,boolean lock) {
        Stored row=episodes.episode(id,lock); if(row==null) throw AssignmentFailure.notFound(); return row;
    }
    private <T> T execute(TransactionTemplate tx,Supplier<T> action) {
        try { return tx.execute(status->action.get()); }
        catch(DataAccessException | TransactionException failure) { throw AssignmentFailure.unavailable(); }
    }
    private static long actorId(CurrentUser user) { return Long.parseLong(user.user().id()); }
    private static long path(String value) {
        if(value==null || !value.matches("^[1-9][0-9]{0,17}$")) throw AssignmentFailure.notFound();
        return Long.parseLong(value);
    }
    private static BigInteger number(String value) {
        if(value==null || !value.matches("[0-9]+")) throw AssignmentFailure.invalid();
        return new BigInteger(value);
    }
}
