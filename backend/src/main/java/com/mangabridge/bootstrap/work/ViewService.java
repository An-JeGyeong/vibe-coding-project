package com.mangabridge.bootstrap.work;
import com.mangabridge.bootstrap.episode.EpisodeDao;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.*;
import org.springframework.transaction.support.TransactionTemplate;
@Service
public class ViewService {
 private final ViewDao dao;private final EpisodeDao episodes;private final TransactionTemplate write;
 public ViewService(ViewDao dao,EpisodeDao episodes,PlatformTransactionManager manager){this.dao=dao;this.episodes=episodes;write=new TransactionTemplate(manager);}
 public void recordView(String path){long episode=WorkService.path(path);try{write.execute(status->{if(episodes.episode(episode,true)==null||!dao.published(episode))throw WorkFailure.missing();dao.increment(episode);return null;});}catch(DataAccessException|TransactionException failure){throw WorkFailure.unavailable();}}
}
