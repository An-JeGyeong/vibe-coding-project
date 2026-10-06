SET foreign_key_checks=0;
ALTER TABLE episode_source_version
    MODIFY COLUMN created_by BIGINT NOT NULL,
    MODIFY COLUMN created_at DATETIME(6) NOT NULL,
    MODIFY COLUMN block_count INT NOT NULL;
SET foreign_key_checks=1;
