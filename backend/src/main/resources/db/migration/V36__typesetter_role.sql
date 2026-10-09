ALTER TABLE demo_account DROP CHECK chk_demo_role, ADD CONSTRAINT chk_demo_role CHECK (role IN ('OPERATOR','TRANSLATOR','REVIEWER','READER','TYPESETTER'));
ALTER TABLE episode_assignment DROP CHECK ck_assignment_role, ADD CONSTRAINT ck_assignment_role CHECK (assignee_role IN ('TRANSLATOR','REVIEWER','TYPESETTER'));
