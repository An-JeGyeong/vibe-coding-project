SET foreign_key_checks=0;
ALTER TABLE publication
    MODIFY COLUMN episode_id BIGINT NOT NULL,
    MODIFY COLUMN translation_version_id BIGINT NOT NULL,
    MODIFY COLUMN source_version_no INT NOT NULL,
    MODIFY COLUMN published_by BIGINT NOT NULL,
    MODIFY COLUMN published_at DATETIME(6) NOT NULL;
SET foreign_key_checks=1;
