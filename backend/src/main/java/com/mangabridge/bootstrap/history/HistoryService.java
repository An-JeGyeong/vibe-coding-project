package com.mangabridge.bootstrap.history;

import static com.mangabridge.bootstrap.history.HistoryModels.*;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionException;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class HistoryService {
    private static final Set<String> KEYS=Set.of("episodeId","event","limit","offset");
    private static final Set<String> EVENTS=Set.of("EPISODE_CREATED","SOURCE_SAVED","ASSIGNED","TRANSLATION_CREATED",
            "TRANSLATION_SUBMITTED","REVIEW_APPROVED","REVIEW_REJECTED","APPROVAL_INVALIDATED","TRANSLATION_PUBLISHED","PUBLICATION_HELD","PUBLICATION_RESUMED","PAGE_IMAGE_SAVED","TRANSLATION_PAGE_IMAGE_SAVED");
    private final HistoryDao dao;
    private final TransactionTemplate read;
    public HistoryService(HistoryDao dao,PlatformTransactionManager manager) {
        this.dao=dao;read=new TransactionTemplate(manager);read.setReadOnly(true);
    }
    public History listHistory(Map<String,List<String>> query) {
        for(var entry:query.entrySet()) {
            if(!KEYS.contains(entry.getKey()) || entry.getValue()==null || entry.getValue().size()!=1 || entry.getValue().get(0)==null)
                throw HistoryFailure.invalid();
        }
        String id=value(query,"episodeId",null),event=value(query,"event",null);
        if(id!=null && !id.matches("^[1-9][0-9]{0,17}$")) throw HistoryFailure.invalid();
        if(event!=null && !EVENTS.contains(event)) throw HistoryFailure.invalid();
        BigInteger limit=number(value(query,"limit","50")),offset=number(value(query,"offset","0"));
        if(limit.signum()<1 || limit.compareTo(BigInteger.valueOf(100))>0) throw HistoryFailure.invalid();
        var filter=new Filter(id==null?null:Long.parseLong(id),event,limit.intValue(),offset);
        try {return read.execute(status->{
            long total=dao.count(filter);
            return new History(offset.compareTo(BigInteger.valueOf(total))>=0?List.of():dao.items(filter),total);
        });} catch(DataAccessException | TransactionException failure) {throw HistoryFailure.unavailable();}
    }
    private static String value(Map<String,List<String>> query,String key,String fallback) {
        return query.containsKey(key)?query.get(key).get(0):fallback;
    }
    private static BigInteger number(String value) {
        if(!value.matches("^[0-9]+$")) throw HistoryFailure.invalid();return new BigInteger(value);
    }
}
