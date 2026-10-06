SET foreign_key_checks=0;
ALTER TABLE review_decision
    MODIFY COLUMN translation_version_id BIGINT NOT NULL,
    MODIFY COLUMN decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    MODIFY COLUMN reviewer_id BIGINT NOT NULL,
    MODIFY COLUMN source_version_no INT NOT NULL,
    MODIFY COLUMN decided_at DATETIME(6) NOT NULL;
SET foreign_key_checks=1;
