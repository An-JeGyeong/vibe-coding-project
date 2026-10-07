package com.mangabridge.bootstrap.ai;

import static com.mangabridge.bootstrap.ai.AiModels.*;
import com.mangabridge.bootstrap.assignment.AssignmentDao;
import com.mangabridge.bootstrap.auth.AuthModels.CurrentUser;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import com.mangabridge.bootstrap.translation.TranslationDao;
import java.time.Clock;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class AiService {
    private final EpisodeDao episodes;
    private final TranslationDao translations;
    private final AssignmentDao assignments;
    private final AiAdapter adapter;
    private final AiSettings settings;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private record Request(long actor,long episode,int version) { }
    private final Set<Request> running=ConcurrentHashMap.newKeySet();
    public AiService(EpisodeDao episodes,TranslationDao translations,AssignmentDao assignments,AiAdapter adapter,
            AiSettings settings,Clock clock,PlatformTransactionManager manager) {
        this.episodes=episodes;this.translations=translations;this.assignments=assignments;
        this.adapter=adapter;this.settings=settings;this.clock=clock;
        transaction=new TransactionTemplate(manager);transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }
    public Result requestAiDraft(CurrentUser actor,String pathId,String pathVersion) {
        long episode=path(pathId,false),account=Long.parseLong(actor.user().id());int number=(int)path(pathVersion,true);
        var request=new Request(account,episode,number);
        if(!running.add(request)) throw AiFailure.state(null);
        try {
            List<Source> sources;
            try {
                sources=transaction.execute(status->{
                    var row=episodes.episode(episode,true);
                    if(row==null||!assignments.assigned(episode,account,"TRANSLATOR")) throw AiFailure.notFound();
                    var version=translations.version(episode,number);
                    if(version==null) throw AiFailure.notFound();
                    if(!version.status().equals("DRAFT")||version.sourceVersion()!=row.latest()) throw AiFailure.state(version.status());
                    var selected=translations.blocks(episode,version).stream().filter(b->blank(b.text()))
                            .limit(50).map(b->new Source(b.seq(),b.source())).toList();
                    if(!selected.isEmpty()) translations.audit(account,"AI_DRAFT_REQUESTED",episode,version.sourceVersion(),version.id(),clock.instant().truncatedTo(ChronoUnit.MICROS));
                    return selected;
                });
            } catch(DataAccessException|TransactionException failure) { throw AiFailure.database(); }
            // The audit is committed and the episode lock released before any provider I/O.
            String provider=settings.provider();
            if(sources.isEmpty()) return new Result(number,provider,List.of());
            var requested=new HashSet<Integer>();sources.forEach(s->requested.add(s.seq()));
            var valid=new TreeMap<Integer,Suggestion>();
            for(var suggestion:adapter.generate(sources)) {
                if(suggestion!=null&&requested.contains(suggestion.seq())&&validText(suggestion.text())) valid.putIfAbsent(suggestion.seq(),suggestion);
            }
            return new Result(number,provider,List.copyOf(valid.values()));
        } finally { running.remove(request); }
    }
    private static long path(String value,boolean version) {
        if(value==null||!value.matches(version?"^[1-9][0-9]{0,8}$":"^[1-9][0-9]{0,17}$")) throw AiFailure.notFound();
        return Long.parseLong(value);
    }
    static boolean blank(String text) { return text==null||text.codePoints().allMatch(c->Character.isWhitespace(c)||Character.isSpaceChar(c)); }
    static boolean validText(String text) {
        return !blank(text)&&text.codePointCount(0,text.length())<=4000&&text.codePoints()
                .noneMatch(c->Character.isISOControl(c)&&c!='\t'&&c!='\n'&&c!='\r');
    }
}
