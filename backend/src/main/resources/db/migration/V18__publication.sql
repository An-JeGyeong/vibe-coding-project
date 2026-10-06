CREATE TABLE publication (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    episode_id BIGINT,
    translation_version_id BIGINT,
    source_version_no INT,
    published_by BIGINT,
    published_at DATETIME(6),
    CONSTRAINT fk_publication_translation FOREIGN KEY (episode_id, translation_version_id) REFERENCES translation_version(episode_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_publication_source FOREIGN KEY (episode_id, source_version_no) REFERENCES episode_source_version(episode_id, version_no) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_publication_operator FOREIGN KEY (published_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
