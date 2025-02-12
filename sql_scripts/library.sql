DROP TABLE IF EXISTS user_manhwa_activity;

CREATE TABLE user_manhwa_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, -- Identificador único
  user_id INTEGER NOT NULL,            -- Relación con la tabla de usuarios
  manhwa_id INTEGER NOT NULL,          -- Relación con la tabla de manhwas
  chapters_read INTEGER DEFAULT 0,     -- Cantidad de capítulos leídos
  last_read_date DATE,                 -- Última fecha de lectura
  favorite BOOLEAN DEFAULT 0,          -- Si el manhwa está marcado como favorito
  progress TEXT,                       -- Progreso: "en progreso", "completado", etc.
  review TEXT,                         -- Reseña del usuario
  rating INTEGER CHECK (rating >= 0 AND rating <= 10), -- Calificación (0-10)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (manhwa_id) REFERENCES manhwas(id) ON DELETE CASCADE
);
