-- Persist the workflow-measured pipeline duration (step: pipeline metrics fix).
--
-- Before this, the admin dashboard derived duration from
-- (completed_at - created_at), but the sessions row was only inserted at the
-- end of the pipeline, so both timestamps landed at the same instant and every
-- duration showed 0 ms. We now (1) insert a 'processing' row at the start of the
-- workflow so created_at is a real start time, and (2) store the precise,
-- retry-aware elapsed time the workflow already computes (composite.elapsedMs)
-- here. Nullable for back-compat: existing rows stay NULL and the dashboard
-- falls back to wall-clock (completed_at - created_at) for them.

ALTER TABLE sessions ADD COLUMN pipeline_ms INTEGER;
