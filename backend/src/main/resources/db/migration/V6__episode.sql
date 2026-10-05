CREATE TABLE episode (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(100),
    latest_source_version INT NOT NULL DEFAULT 0,
    created_by BIGINT,
    created_at DATETIME(6),
    updated_at DATETIME(6),
    CONSTRAINT fk_episode_creator FOREIGN KEY (created_by) REFERENCES demo_account(id)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
