CREATE TABLE auth_login_limit (
    limit_key BINARY(32) NOT NULL PRIMARY KEY,
    failures INT NOT NULL DEFAULT 0,
    window_start DATETIME(6) NOT NULL,
    blocked_until DATETIME(6) NULL,
    updated_at DATETIME(6) NOT NULL,
    INDEX ix_limit_cleanup (updated_at)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
