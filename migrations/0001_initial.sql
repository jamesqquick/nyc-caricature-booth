-- Initial schema for NYC Caricature Booth (step 1.2)
-- Just the sessions table for now; we'll extend in later phases.

CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	created_at INTEGER NOT NULL DEFAULT (unixepoch()),
	status TEXT NOT NULL DEFAULT 'pending'
);

CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at DESC);
