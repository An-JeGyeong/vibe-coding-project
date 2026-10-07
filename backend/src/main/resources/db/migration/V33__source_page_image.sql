CREATE TABLE source_page_image (
    episode_id BIGINT NOT NULL,
    page_no INT NOT NULL,
    content_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    byte_size INT NOT NULL,
    image_data MEDIUMBLOB NOT NULL,
    uploaded_by BIGINT NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    PRIMARY KEY (episode_id, page_no),
    CONSTRAINT ck_source_page_image_type CHECK (content_type IN ('image/png','image/jpeg','image/webp')),
    CONSTRAINT ck_source_page_image_size CHECK (byte_size BETWEEN 1 AND 5242880),
    CONSTRAINT ck_source_page_image_page CHECK (page_no BETWEEN 1 AND 9999),
    CONSTRAINT fk_source_page_image_episode FOREIGN KEY (episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT fk_source_page_image_uploader FOREIGN KEY (uploaded_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
