-- Per-event watermark sizing (width in pixels, aspect ratio preserved).
-- NULL means use the default (POSTCARD_WATERMARK_W = 540).
ALTER TABLE events ADD COLUMN watermark_w INTEGER;
ALTER TABLE events ADD COLUMN watermark_left_w INTEGER;
