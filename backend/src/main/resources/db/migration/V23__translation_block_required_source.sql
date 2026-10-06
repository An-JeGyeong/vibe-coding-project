ALTER TABLE translation_block
    MODIFY COLUMN episode_id BIGINT NOT NULL,
    MODIFY COLUMN source_version_no INT NOT NULL;
