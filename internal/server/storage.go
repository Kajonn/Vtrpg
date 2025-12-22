package server

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"

	_ "modernc.org/sqlite"
)

// openDatabase prepares a SQLite database at the given path and ensures the schema exists.
func openDatabase(path string) (*sql.DB, error) {
	if path == "" {
		return nil, errors.New("database path is empty")
	}

	if err := ensureDir(filepath.Dir(path)); err != nil {
		return nil, fmt.Errorf("ensure db directory: %w", err)
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	if _, err := db.Exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`); err != nil {
		db.Close()
		return nil, fmt.Errorf("configure sqlite: %w", err)
	}

	if err := initSchema(db); err != nil {
		db.Close()
		return nil, err
	}

	return db, nil
}

func initSchema(db *sql.DB) error {
	schema := []string{
		`CREATE TABLE IF NOT EXISTS rooms (
			id TEXT PRIMARY KEY,
			slug TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			created_by TEXT,
			created_at TIMESTAMP NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS room_activity (
			room_id TEXT PRIMARY KEY,
			last_used_at TIMESTAMP,
			total_active_seconds INTEGER NOT NULL DEFAULT 0,
			active_since TIMESTAMP,
			FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS players (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			name TEXT NOT NULL,
			token TEXT NOT NULL UNIQUE,
			role TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS images (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			url TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at TIMESTAMP NOT NULL,
			x REAL NOT NULL DEFAULT 0,
			y REAL NOT NULL DEFAULT 0,
			FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS dice_logs (
			id TEXT PRIMARY KEY,
			room_id TEXT NOT NULL,
			seed INTEGER NOT NULL,
			count INTEGER NOT NULL,
			results TEXT NOT NULL,
			triggered_by TEXT NOT NULL,
			timestamp TIMESTAMP NOT NULL,
			FOREIGN KEY(room_id) REFERENCES rooms(id) ON DELETE CASCADE
		);`,
		`CREATE INDEX IF NOT EXISTS idx_dice_logs_room_timestamp ON dice_logs(room_id, timestamp DESC, id DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_images_room_created ON images(room_id, created_at);`,
		`CREATE INDEX IF NOT EXISTS idx_players_room_created ON players(room_id, created_at DESC, id DESC);`,
		`CREATE INDEX IF NOT EXISTS idx_room_activity_last_used ON room_activity(last_used_at DESC);`,
	}

	for _, stmt := range schema {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("apply schema: %w", err)
		}
	}

	return nil
}

// Close releases database resources.
func (s *Server) Close() error {
	if s.db != nil {
		return s.db.Close()
	}
	return nil
}
