CREATE TABLE account_profile (
 account_id BIGINT NOT NULL,
 bio VARCHAR(100) NOT NULL,
 updated_at DATETIME(6) NOT NULL,
 PRIMARY KEY (account_id),
 CONSTRAINT fk_profile_account FOREIGN KEY (account_id) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE account_library (
 account_id BIGINT NOT NULL,
 work_id BIGINT NOT NULL,
 added_at DATETIME(6) NOT NULL,
 PRIMARY KEY (account_id, work_id),
 CONSTRAINT fk_library_account FOREIGN KEY (account_id) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_library_work FOREIGN KEY (work_id) REFERENCES work(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE account_recent (
 account_id BIGINT NOT NULL,
 episode_id BIGINT NOT NULL,
 read_at DATETIME(6) NOT NULL,
 PRIMARY KEY (account_id, episode_id),
 CONSTRAINT fk_recent_account FOREIGN KEY (account_id) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_recent_episode FOREIGN KEY (episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
