CREATE TABLE auth_token (
    token_hash BINARY(32) NOT NULL PRIMARY KEY,
    account_id BIGINT NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    FOREIGN KEY (account_id) REFERENCES demo_account(id),
    INDEX ix_token_expiry (expires_at),
    INDEX ix_token_revoked (revoked_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
