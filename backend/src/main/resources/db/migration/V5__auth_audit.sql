CREATE TABLE auth_audit (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    occurred_at DATETIME(6) NOT NULL,
    account_id BIGINT NULL,
    event VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    reason VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    INDEX ix_audit_cleanup (occurred_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
