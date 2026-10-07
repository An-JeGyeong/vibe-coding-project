CREATE TABLE review_block_comment (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    review_decision_id BIGINT NOT NULL,
    translation_version_id BIGINT NOT NULL,
    source_seq INT NOT NULL,
    body VARCHAR(300) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    CONSTRAINT ck_review_block_comment_body CHECK (CHAR_LENGTH(body) BETWEEN 1 AND 300),
    CONSTRAINT uq_review_block_comment_seq UNIQUE (review_decision_id, source_seq),
    CONSTRAINT fk_review_block_comment_decision FOREIGN KEY (review_decision_id) REFERENCES review_decision(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_review_block_comment_block FOREIGN KEY (translation_version_id, source_seq) REFERENCES translation_block(translation_version_id, source_seq) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
