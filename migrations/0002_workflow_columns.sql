-- Add workflow artifact columns to sessions (step 4.4)
-- The workflow's `store` step upserts a row with these values once the
-- pipeline finishes. All columns are nullable for back-compat with rows
-- written by the original /api/test-db endpoint.

ALTER TABLE sessions ADD COLUMN scene_id TEXT;
ALTER TABLE sessions ADD COLUMN scene_name TEXT;
ALTER TABLE sessions ADD COLUMN selfie_key TEXT;
ALTER TABLE sessions ADD COLUMN caricature_key TEXT;
ALTER TABLE sessions ADD COLUMN postcard_key TEXT;
ALTER TABLE sessions ADD COLUMN workflow_instance_id TEXT;
ALTER TABLE sessions ADD COLUMN completed_at INTEGER;
ALTER TABLE sessions ADD COLUMN error_msg TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_workflow_instance ON sessions(workflow_instance_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
