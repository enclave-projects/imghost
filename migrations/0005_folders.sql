-- Migration: 0005_folders
-- Adds user-owned folders + folder_id column on images. NULL folder_id = root.

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_folders_user_name ON folders(user_id, name);

ALTER TABLE images ADD COLUMN folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_images_folder ON images(user_id, folder_id);
