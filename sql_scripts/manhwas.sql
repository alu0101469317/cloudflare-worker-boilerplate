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
  background TEXT
);
