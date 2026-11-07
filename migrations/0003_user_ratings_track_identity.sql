-- Keep one playback identity column. YouTube IDs remain recoverable from youtube: track keys.
ALTER TABLE user_ratings RENAME COLUMN video_id TO track_id;
ALTER TABLE user_ratings ADD COLUMN album TEXT NOT NULL DEFAULT '';
