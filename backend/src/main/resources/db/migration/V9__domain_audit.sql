CREATE TABLE domain_audit (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    occurred_at DATETIME(6),
    actor_account_id BIGINT NOT NULL,
    event VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin,
    episode_id BIGINT NULL,
    source_version INT NULL,
    CONSTRAINT fk_domain_actor FOREIGN KEY (actor_account_id) REFERENCES demo_account(id),
    INDEX ix_domain_audit_time (occurred_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
