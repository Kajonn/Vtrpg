package server

import (
	"net/http"
	"strings"
)

func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigin := s.matchOrigin(origin)

		if origin != "" && allowedOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowedOrigin)
			if allowedOrigin != "*" {
				w.Header().Set("Vary", "Origin")
				w.Header().Set("Access-Control-Allow-Credentials", "true")
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
		}

		// Add security headers
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		// Content-Security-Policy for API responses
		if !strings.HasPrefix(r.URL.Path, "/uploads/") && r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/assets/") {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		}

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) matchOrigin(origin string) string {
	if origin == "" {
		if s.allowAllOrigins {
			return "*"
		}
		return ""
	}

	for _, allowed := range s.allowedOrigins {
		if strings.EqualFold(allowed, origin) {
			return allowed
		}
	}

	if s.allowAllOrigins {
		return "*"
	}

	return ""
}
