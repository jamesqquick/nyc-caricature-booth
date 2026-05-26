-- Multi-event support: events, scenes, event_admins tables.
-- Adds event_id to sessions and print_jobs with NYC backfill.

-- -----------------------------------------------------------------------
-- 1. New tables
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS events (
	id                    TEXT PRIMARY KEY,
	name                  TEXT NOT NULL,
	status                TEXT NOT NULL DEFAULT 'draft',  -- draft | active | archived

	-- branding
	accent_color          TEXT NOT NULL DEFAULT '#f6821f',
	watermark_image_key   TEXT,
	watermark_image_key_left TEXT,

	-- copy
	tagline               TEXT NOT NULL DEFAULT 'Take a selfie, pick a scene, walk away with a printed postcard.',
	kiosk_idle_subhead    TEXT NOT NULL DEFAULT 'Cloudflare Kiosk · For more information on Cloudflare, visit cloudflare.com',
	scene_picker_heading  TEXT NOT NULL DEFAULT 'Pick your scene',

	-- prompt defaults (starter text for new scenes, not used at runtime)
	scene_style_preamble  TEXT,
	scene_constraints     TEXT,

	-- misc
	timezone              TEXT NOT NULL DEFAULT 'America/New_York',
	privacy_email         TEXT NOT NULL DEFAULT '',

	created_at            INTEGER NOT NULL DEFAULT (unixepoch()),
	created_by            TEXT
);

CREATE TABLE IF NOT EXISTS scenes (
	event_id    TEXT NOT NULL,
	id          TEXT NOT NULL,
	name        TEXT NOT NULL,
	emoji       TEXT NOT NULL DEFAULT '',
	description TEXT NOT NULL DEFAULT '',
	prompt      TEXT NOT NULL DEFAULT '',
	sort_order  INTEGER NOT NULL DEFAULT 0,
	is_active   INTEGER NOT NULL DEFAULT 1,
	PRIMARY KEY (event_id, id),
	FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE INDEX IF NOT EXISTS idx_scenes_event ON scenes(event_id, sort_order);

CREATE TABLE IF NOT EXISTS event_admins (
	event_id    TEXT NOT NULL,
	admin_email TEXT NOT NULL,
	role        TEXT NOT NULL DEFAULT 'editor',  -- owner | editor
	added_at    INTEGER NOT NULL DEFAULT (unixepoch()),
	PRIMARY KEY (event_id, admin_email),
	FOREIGN KEY (event_id) REFERENCES events(id)
);

-- -----------------------------------------------------------------------
-- 2. Add event_id to existing tables (nullable first, then backfill)
-- -----------------------------------------------------------------------

ALTER TABLE sessions ADD COLUMN event_id TEXT;
ALTER TABLE print_jobs ADD COLUMN event_id TEXT;

-- Backfill all existing rows to the NYC event
UPDATE sessions SET event_id = 'nyc-tech-week-2026' WHERE event_id IS NULL;
UPDATE print_jobs SET event_id = 'nyc-tech-week-2026' WHERE event_id IS NULL;

-- Index for event-scoped queries
CREATE INDEX IF NOT EXISTS idx_sessions_event ON sessions(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_print_jobs_event ON print_jobs(event_id, status, created_at);

-- -----------------------------------------------------------------------
-- 3. Seed the NYC event
-- -----------------------------------------------------------------------

INSERT INTO events (
	id, name, status,
	accent_color,
	tagline, kiosk_idle_subhead, scene_picker_heading,
	scene_style_preamble, scene_constraints,
	timezone, privacy_email
) VALUES (
	'nyc-tech-week-2026',
	'NY Tech Week 2026',
	'active',
	'#f6821f',
	'Take a selfie, pick an iconic NYC scene, walk away with a printed postcard.',
	'Cloudflare · NY Tech Week 2026',
	'Pick your NYC scene',
	'Transform the uploaded photo into a hand-drawn New York street caricature in bold black pen and ink on bright white poster paper, as if drawn live by a skilled boardwalk caricature artist.

Preserve the person''s clear facial likeness and identity from the uploaded image.
Use exaggerated but flattering caricature proportions: oversized head, compact body, expressive face, lively asymmetry, and spontaneous human imperfections.
Render with confident marker contours, scratchy cross-hatching, and cool gray marker shadows only.
The result should feel like a fast live-sketch from a real tourist caricature stand.',
	'Hard constraints:
- no text anywhere
- no letters
- no words
- no visible signage
- no logo
- no signature
- no caption

Avoid:
- Peanuts-like simplification
- cute children''s-book style
- watercolor
- polished vector art
- glossy digital illustration
- anime
- photorealism',
	'America/New_York',
	'devrel@cloudflare.com'
);

-- -----------------------------------------------------------------------
-- 4. Seed the 6 NYC scenes
-- -----------------------------------------------------------------------

-- Scene prompts contain ONLY the scene-specific placement/setting text.
-- At runtime the workflow composes the final prompt as:
--   event.scene_style_preamble + scene.prompt + event.scene_constraints

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'hot-dog-stand', 'Hot Dog Stand', '🌭',
 'Grabbing a dirty water dog from a classic NYC street cart.', 0,
 'Place the subject at a New York City hot dog cart on a busy Manhattan sidewalk.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from the hot dog cart: striped cart umbrella, steam wisps, cart cylinder silhouette.
The location should read clearly at a glance without overpowering the caricature.');

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'subway', 'Subway Platform', '🚇',
 'Waiting on the platform as the train rolls in.', 1,
 'Place the subject on a New York City subway platform.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from the subway platform: tiled wall pattern, train car silhouette.
The location should read clearly at a glance without overpowering the caricature.');

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'central-park', 'Central Park', '🌳',
 'Strolling past the Bow Bridge on a perfect spring day.', 2,
 'Place the subject on the Bow Bridge in Central Park.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from Central Park: arched stone bridge railing, tree canopy silhouettes, distant skyline.
The location should read clearly at a glance without overpowering the caricature.');

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'broadway', 'Broadway', '🎭',
 'Under the glow of a Broadway marquee in the theater district.', 3,
 'Place the subject outside a Broadway theater at night.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from Broadway: bulb-lit marquee arch shapes, entrance carpet runner, theater curtain silhouette.
The location should read clearly at a glance without overpowering the caricature.');

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'times-square', 'Times Square', '🌆',
 'Standing in the middle of Times Square''s neon chaos.', 4,
 'Place the subject in Times Square at night.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from Times Square: tall rectangle billboard shapes, dense crowd outlines.
The location should read clearly at a glance without overpowering the caricature.');

INSERT INTO scenes (event_id, id, name, emoji, description, sort_order, prompt) VALUES
('nyc-tech-week-2026', 'brooklyn-bridge', 'Brooklyn Bridge', '🌉',
 'Walking the Brooklyn Bridge with the skyline behind.', 5,
 'Place the subject on the pedestrian walkway of the Brooklyn Bridge.
Keep the background minimal and secondary.
Use only a few lightly suggested visual cues from the Brooklyn Bridge: suspension cable fans, stone tower arch, Manhattan skyline silhouette.
The location should read clearly at a glance without overpowering the caricature.');
