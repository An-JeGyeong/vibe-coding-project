SET foreign_key_checks=0;
ALTER TABLE episode
    MODIFY COLUMN title VARCHAR(100) NOT NULL,
    MODIFY COLUMN created_by BIGINT NOT NULL,
    MODIFY COLUMN created_at DATETIME(6) NOT NULL,
    MODIFY COLUMN updated_at DATETIME(6) NOT NULL;
SET foreign_key_checks=1;
