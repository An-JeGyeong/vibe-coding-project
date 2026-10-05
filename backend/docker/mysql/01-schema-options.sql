-- The entrypoint selects MYSQL_DATABASE before loading this file.
-- Explicit schema defaults; no domain tables. Used only on a fresh MySQL volume.
ALTER DATABASE CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
