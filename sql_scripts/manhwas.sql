DROP TABLE IF EXISTS manhwas;

CREATE TABLE manhwas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  website_title TEXT,
  website TEXT,
  alt_title TEXT,
  type TEXT,
  volumes INTEGER,
  chapters INTEGER,
  status TEXT,
  published_start DATE,
  published_end DATE,
  genres TEXT,
  themes TEXT,
  serialization TEXT,
  authors TEXT,
  members INTEGER,
  favorites INTEGER,
  synopsis TEXT,
  background TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to update 'updated_at' on any row update
CREATE TRIGGER update_manhwa_timestamp
AFTER UPDATE ON manhwas
FOR EACH ROW
BEGIN
  UPDATE manhwas SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;
