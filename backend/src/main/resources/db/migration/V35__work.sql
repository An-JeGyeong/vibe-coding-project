CREATE TABLE work (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 title VARCHAR(100) NOT NULL, author VARCHAR(100) NOT NULL, description VARCHAR(2000) NOT NULL,
 reading_direction VARCHAR(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 is_public TINYINT(1) NOT NULL, is_featured TINYINT(1) NOT NULL, is_banner TINYINT(1) NOT NULL,
 revision INT NOT NULL, created_by BIGINT NOT NULL, created_at DATETIME(6) NOT NULL, updated_at DATETIME(6) NOT NULL,
 CONSTRAINT ck_work_direction CHECK(reading_direction IN ('RTL','LTR')),
 CONSTRAINT ck_work_public CHECK(is_public IN (0,1)), CONSTRAINT ck_work_featured CHECK(is_featured IN (0,1)),
 CONSTRAINT ck_work_banner CHECK(is_banner IN (0,1)), CONSTRAINT ck_work_revision CHECK(revision>=1),
 CONSTRAINT fk_work_creator FOREIGN KEY(created_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE work_genre (
 work_id BIGINT NOT NULL, genre VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 PRIMARY KEY(work_id,genre),
 CONSTRAINT ck_work_genre CHECK(genre IN ('판타지','액션','로맨스','코미디','일상','미스터리','스릴러','SF','스포츠','드라마')),
 CONSTRAINT fk_work_genre FOREIGN KEY(work_id) REFERENCES work(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE work_cover (
 work_id BIGINT NOT NULL PRIMARY KEY, content_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 byte_size INT NOT NULL, image_data MEDIUMBLOB NOT NULL, uploaded_by BIGINT NOT NULL, updated_at DATETIME(6) NOT NULL,
 CONSTRAINT ck_work_cover_type CHECK(content_type IN ('image/png','image/jpeg','image/webp')),
 CONSTRAINT ck_work_cover_size CHECK(byte_size BETWEEN 1 AND 5242880),
 CONSTRAINT fk_work_cover FOREIGN KEY(work_id) REFERENCES work(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_work_cover_uploader FOREIGN KEY(uploaded_by) REFERENCES demo_account(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE work_episode (
 episode_id BIGINT NOT NULL PRIMARY KEY, work_id BIGINT NOT NULL, episode_no INT NOT NULL,
 CONSTRAINT uq_work_episode_no UNIQUE(work_id,episode_no), CONSTRAINT ck_work_episode_no CHECK(episode_no BETWEEN 1 AND 9999),
 CONSTRAINT fk_work_episode_episode FOREIGN KEY(episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CONSTRAINT fk_work_episode_work FOREIGN KEY(work_id) REFERENCES work(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE TABLE episode_view_count (
 episode_id BIGINT NOT NULL PRIMARY KEY, view_count BIGINT NOT NULL,
 CONSTRAINT ck_episode_views CHECK(view_count>=0),
 CONSTRAINT fk_episode_views FOREIGN KEY(episode_id) REFERENCES episode(id) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
