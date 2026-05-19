-- Add email opt-in column to sessions (step 9.2)
-- Attendees can submit their email on /p/:id to receive a digital copy.
-- NULL = not submitted; non-null = opted in (email delivery handled in 9.3).

ALTER TABLE sessions ADD COLUMN email TEXT;
ALTER TABLE sessions ADD COLUMN email_submitted_at INTEGER;
