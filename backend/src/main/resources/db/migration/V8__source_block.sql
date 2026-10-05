CREATE TABLE source_block (
    episode_id BIGINT,
    version_no INT,
    seq INT,
    page_no INT NULL,
    body VARCHAR(2000),
    PRIMARY KEY (episode_id, version_no, seq),
    CONSTRAINT fk_block_source FOREIGN KEY (episode_id, version_no)
        REFERENCES episode_source_version(episode_id, version_no),
    CONSTRAINT ck_block_seq CHECK (seq >= 1),
    CONSTRAINT ck_block_page CHECK (page_no IS NULL OR page_no BETWEEN 1 AND 9999)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
