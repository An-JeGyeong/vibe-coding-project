CREATE TABLE review_decision (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    translation_version_id BIGINT UNIQUE,
    decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin,
    reason VARCHAR(500) NULL,
    reviewer_id BIGINT,
    source_version_no INT,
    decided_at DATETIME(6),
    invalidated_at DATETIME(6) NULL,
    CONSTRAINT fk_review_translation FOREIGN KEY (translation_version_id) REFERENCES translation_version(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_reviewer FOREIGN KEY (reviewer_id) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_review_decision CHECK (decision IN ('APPROVED','REJECTED')),
    CONSTRAINT ck_review_reason CHECK ((decision='REJECTED' AND reason IS NOT NULL AND CHAR_LENGTH(reason) BETWEEN 1 AND 500) OR (decision='APPROVED' AND reason IS NULL)),
    CONSTRAINT ck_review_invalidation CHECK (invalidated_at IS NULL OR decision='APPROVED')
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
