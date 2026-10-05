package com.mangabridge.bootstrap.episode;

import static com.mangabridge.bootstrap.episode.EpisodeModels.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import java.math.BigInteger;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class EpisodeService {
    private final EpisodeDao dao;
    private final Clock clock;
    private final TransactionTemplate write,read;
    public EpisodeService(EpisodeDao dao,Clock clock,PlatformTransactionManager manager) {
        this.dao=dao; this.clock=clock;
        write=new TransactionTemplate(manager); read=new TransactionTemplate(manager); read.setReadOnly(true);
    }
    public Created createEpisode(CreateRequest request,CurrentUser actor) {
        String title=text(request==null?null:request.title(),100,false);
        return execute(write,()->{
            Instant now=now(); long id=dao.insertEpisode(title,actorId(actor),now);
            dao.audit(actorId(actor),"EPISODE_CREATED",id,null,now);
            return new Created(Long.toString(id),title,0,now);
        });
    }
    public Episodes listEpisodes(String limit,String offset) {
        BigInteger size=number(limit),start=number(offset);
        if(size.signum()<=0 || size.compareTo(BigInteger.valueOf(100))>0) throw EpisodeFailure.invalid();
        return execute(read,()->{
            long total=dao.countEpisodes();
            return new Episodes(start.compareTo(BigInteger.valueOf(total))>=0?List.of():dao.episodes(size.intValue(),start.longValueExact()),total);
        });
    }
    public Detail getEpisode(String pathId) {
        long id=path(pathId);
        return execute(read,()->{
            Stored row=required(id,false);
            return new Detail(Long.toString(id),row.title(),row.latest(),row.createdAt(),row.updatedAt(),
                    row.latest()==0?null:dao.source(id,row.latest()));
        });
    }
    public Map<String,Object> saveSourceVersion(String pathId,SourceRequest request,CurrentUser actor) {
        long id=path(pathId);
        if(request==null || request.expectedVersion()==null || !request.expectedVersion().isIntegralNumber()
                || request.expectedVersion().bigIntegerValue().signum()<0 || request.blocks()==null
                || request.blocks().isEmpty() || request.blocks().size()>200) throw EpisodeFailure.invalid();
        BigInteger expected=request.expectedVersion().bigIntegerValue();
        List<Block> blocks=new ArrayList<>();
        for(BlockRequest input:request.blocks()) {
            if(input==null) throw EpisodeFailure.invalid();
            Integer page=null;
            if(input.pageNo()!=null && !input.pageNo().isNull()) {
                if(!input.pageNo().isIntegralNumber() || input.pageNo().bigIntegerValue().signum()<=0
                        || input.pageNo().bigIntegerValue().compareTo(BigInteger.valueOf(9999))>0) throw EpisodeFailure.invalid();
                page=input.pageNo().intValue();
            }
            blocks.add(new Block(blocks.size()+1,page,text(input.text(),2000,true)));
        }
        return execute(write,()->{
            Stored row=required(id,true);
            if(!expected.equals(BigInteger.valueOf(row.latest()))) throw EpisodeFailure.conflict(row.latest());
            if(row.latest()>0 && dao.source(id,row.latest()).blocks().equals(blocks))
                return Map.of("version",row.latest(),"changed",false);
            int version=Math.addExact(row.latest(),1); Instant now=now();
            dao.insertSource(id,version,actorId(actor),now,blocks);
            dao.audit(actorId(actor),"SOURCE_SAVED",id,version,now);
            return Map.of("version",version,"changed",true,"savedAt",now);
        });
    }
    public Versions listSourceVersions(String pathId) {
        long id=path(pathId);
        return execute(read,()->{ required(id,false); return new Versions(dao.versions(id)); });
    }
    public Source getSourceVersion(String pathId,String pathVersion) {
        long id=path(pathId),version=path(pathVersion);
        return execute(read,()->{
            required(id,false); Source source=dao.source(id,version);
            if(source==null) throw EpisodeFailure.notFound();
            return source;
        });
    }
    private Stored required(long id,boolean lock) {
        Stored row=dao.episode(id,lock); if(row==null) throw EpisodeFailure.notFound(); return row;
    }
    private <T> T execute(TransactionTemplate tx,Supplier<T> action) {
        try { return tx.execute(status->action.get()); }
        catch(DataAccessException | TransactionException failure) { throw EpisodeFailure.unavailable(); }
    }
    private Instant now() { return clock.instant().truncatedTo(ChronoUnit.MICROS); }
    private static long actorId(CurrentUser actor) { return Long.parseLong(actor.user().id()); }
    private static long path(String value) {
        if(value==null || !value.matches("^[1-9][0-9]{0,17}$")) throw EpisodeFailure.notFound();
        return Long.parseLong(value);
    }
    private static BigInteger number(String value) {
        if(value==null || !value.matches("[0-9]+")) throw EpisodeFailure.invalid();
        return new BigInteger(value);
    }
    private static String text(JsonNode value,int maximum,boolean multiline) {
        if(value==null || !value.isTextual()) throw EpisodeFailure.invalid();
        String result=value.textValue(); int count=result.codePointCount(0,result.length());
        if(count<1 || count>maximum || result.codePoints().allMatch(c->Character.isWhitespace(c)||Character.isSpaceChar(c))
                || result.codePoints().anyMatch(c->Character.isISOControl(c) && !(multiline && (c=='\t'||c=='\n'||c=='\r'))))
            throw EpisodeFailure.invalid();
        return result;
    }
}
