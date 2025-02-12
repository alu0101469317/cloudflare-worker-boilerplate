DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,  -- Unique identifier
    username TEXT UNIQUE NOT NULL,         -- Username (must be unique)
    email TEXT UNIQUE NOT NULL,            -- Email (must be unique)
    password TEXT NOT NULL,                -- Hashed password
    role TEXT CHECK(role IN ('user', 'admin')) DEFAULT 'user', -- User role (default is "user")
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP -- Account creation timestamp
);