CREATE TABLE episode_view_daily (
 episode_id BIGINT NOT NULL,
 view_date DATE NOT NULL,
 view_count BIGINT NOT NULL,
 PRIMARY KEY (episode_id, view_date),
 CONSTRAINT ck_daily_view_count CHECK (view_count >= 1),
 CONSTRAINT fk_daily_episode FOREIGN KEY (episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
CREATE TABLE work_recommend (
 work_id BIGINT NOT NULL,
 voter_key CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL,
 PRIMARY KEY (work_id, voter_key),
 CONSTRAINT ck_recommend_voter CHECK (voter_key REGEXP '^[0-9a-f]{32}$'),
 CONSTRAINT fk_recommend_work FOREIGN KEY (work_id) REFERENCES work(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
