-- Print jobs table: the Mac mini print agent polls for pending rows
-- and acks them after printing.
CREATE TABLE IF NOT EXISTS print_jobs (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id TEXT NOT NULL,
  postcard_key TEXT NOT NULL,
  postcard_url TEXT NOT NULL,
  scene_name TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending | printing | printed | failed
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  printed_at INTEGER,
  error_msg  TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX idx_print_jobs_status ON print_jobs(status, created_at);
