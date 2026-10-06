CREATE TABLE translation_block (
    translation_version_id BIGINT,
    episode_id BIGINT,
    source_version_no INT,
    source_seq INT,
    body VARCHAR(4000) NOT NULL,
    PRIMARY KEY (translation_version_id, source_seq),
    CONSTRAINT fk_translation_block_version FOREIGN KEY (translation_version_id, episode_id, source_version_no) REFERENCES translation_version(id, episode_id, source_version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_translation_block_source FOREIGN KEY (episode_id, source_version_no, source_seq) REFERENCES source_block(episode_id, version_no, seq) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_translation_body CHECK (CHAR_LENGTH(body) >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
