package server

import (
	"os"
	"strconv"
	"strings"
)

// Config holds runtime configuration loaded from environment variables.
type Config struct {
	Port           string
	MaxUploadSize  int64
	AllowedOrigins []string
	FrontendDir    string
	UploadDir      string
	DBPath         string
}

const (
	defaultPort          = "8080"
	defaultMaxUploadSize = int64(10 << 20) // 10 MiB
	defaultAllowedOrigin = "*"
	defaultFrontendDir   = "dist"
	defaultUploadDir     = "uploads"
	defaultDBPath        = "data/vtrpg.db"
)

// LoadConfig builds a Config instance using environment variables when present.
func LoadConfig() Config {
	cfg := Config{
		Port:           getEnv("PORT", defaultPort),
		MaxUploadSize:  defaultMaxUploadSize,
		AllowedOrigins: parseAllowedOrigins(getEnv("ALLOWED_ORIGINS", defaultAllowedOrigin)),
		FrontendDir:    getEnv("FRONTEND_DIR", defaultFrontendDir),
		UploadDir:      getEnv("UPLOAD_DIR", defaultUploadDir),
		DBPath:         getEnv("DB_PATH", defaultDBPath),
	}

	if rawMax := os.Getenv("MAX_UPLOAD_SIZE"); rawMax != "" {
		if v, err := strconv.ParseInt(rawMax, 10, 64); err == nil && v > 0 {
			cfg.MaxUploadSize = v
		}
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func parseAllowedOrigins(raw string) []string {
	parts := strings.Split(raw, ",")
	var origins []string
	for _, origin := range parts {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	if len(origins) == 0 {
		origins = []string{defaultAllowedOrigin}
	}
	return origins
}
