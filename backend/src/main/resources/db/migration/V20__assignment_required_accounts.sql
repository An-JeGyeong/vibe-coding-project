ALTER TABLE episode_assignment
    MODIFY COLUMN account_id BIGINT NOT NULL,
    MODIFY COLUMN assigned_by BIGINT NOT NULL;
