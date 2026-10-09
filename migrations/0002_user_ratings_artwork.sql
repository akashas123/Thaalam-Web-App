-- Existing deployments created before the artwork column existed.
ALTER TABLE user_ratings ADD COLUMN artwork TEXT NOT NULL DEFAULT '';