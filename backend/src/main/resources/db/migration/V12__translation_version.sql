CREATE TABLE translation_version (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    episode_id BIGINT,
    version_no INT,
    source_version_no INT,
    status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin,
    created_by BIGINT,
    created_at DATETIME(6),
    submitted_at DATETIME(6) NULL,
    open_slot INT GENERATED ALWAYS AS (CASE WHEN status IN ('DRAFT','REVIEW_PENDING') THEN 1 ELSE NULL END) VIRTUAL,
    CONSTRAINT uq_translation_number UNIQUE (episode_id, version_no),
    CONSTRAINT uq_translation_open UNIQUE (episode_id, open_slot),
    CONSTRAINT uq_translation_episode_id UNIQUE (episode_id, id),
    CONSTRAINT uq_translation_source UNIQUE (id, episode_id, source_version_no),
    CONSTRAINT fk_translation_source FOREIGN KEY (episode_id, source_version_no) REFERENCES episode_source_version(episode_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_translation_creator FOREIGN KEY (created_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_translation_status CHECK (status IN ('DRAFT','REVIEW_PENDING','REJECTED','APPROVED','PUBLISHED','INVALIDATED','ON_HOLD')),
    CONSTRAINT ck_translation_number CHECK (version_no >= 1)
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
