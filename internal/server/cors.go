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
	
	// Apply Content-Security-Policy only to API endpoints (not SPA)
	// SPA routes serve HTML that loads its own JS/CSS via <script> and <link> tags
	// API routes return JSON and should have strict CSP
	if isAPIEndpoint(r.URL.Path) && !shouldServeSPA(r) {
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

// isAPIEndpoint checks if a path is potentially an API endpoint.
// This doesn't account for browser navigation vs API calls - use shouldServeSPA for that.
func isAPIEndpoint(path string) bool {
	// API endpoints that return JSON or handle WebSocket connections
	return strings.HasPrefix(path, "/rooms") ||
		strings.HasPrefix(path, "/ws") ||
		strings.HasPrefix(path, "/admin") ||
		path == "/healthz" ||
		path == "/upload"
}

// shouldServeSPA checks if the request should serve the SPA (HTML) rather than JSON/API response.
// SPA routes need permissive CSP to load scripts and styles.
func shouldServeSPA(r *http.Request) bool {
	// Only GET/HEAD requests can serve SPA
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	
	// Check Accept header to distinguish browser navigation from API calls
	accept := r.Header.Get("Accept")
	return strings.Contains(accept, "text/html")
}
