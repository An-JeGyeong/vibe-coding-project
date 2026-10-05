CREATE TABLE episode_source_version (
    episode_id BIGINT,
    version_no INT,
    created_by BIGINT,
    created_at DATETIME(6),
    block_count INT,
    PRIMARY KEY (episode_id, version_no),
    CONSTRAINT fk_source_episode FOREIGN KEY (episode_id) REFERENCES episode(id),
    CONSTRAINT fk_source_creator FOREIGN KEY (created_by) REFERENCES demo_account(id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
