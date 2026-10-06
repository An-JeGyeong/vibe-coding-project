ALTER TABLE episode ADD CONSTRAINT fk_episode_publication FOREIGN KEY (id, published_translation_version_id) REFERENCES translation_version(episode_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
