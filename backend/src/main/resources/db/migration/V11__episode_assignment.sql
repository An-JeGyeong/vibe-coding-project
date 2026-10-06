CREATE TABLE episode_assignment (
    episode_id BIGINT,
    assignee_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin,
    account_id BIGINT,
    assigned_by BIGINT,
    PRIMARY KEY (episode_id, assignee_role),
    CONSTRAINT fk_assignment_episode FOREIGN KEY (episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_assignment_role FOREIGN KEY (account_id, assignee_role) REFERENCES demo_account(id, role) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_assignment_operator FOREIGN KEY (assigned_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_assignment_role CHECK (assignee_role IN ('TRANSLATOR','REVIEWER'))
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
