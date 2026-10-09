CREATE TABLE IF NOT EXISTS user_ratings (
  user_id TEXT NOT NULL,
  track_key TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('up', 'down')),
  title TEXT NOT NULL DEFAULT '',
  artist TEXT NOT NULL DEFAULT '',
  video_id TEXT,
  artwork TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, track_key)
);

CREATE INDEX IF NOT EXISTS user_ratings_user_updated
  ON user_ratings (user_id, updated_at DESC);
