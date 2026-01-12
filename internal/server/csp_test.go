package server

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCSPHeaders(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	tests := []struct {
		name       string
		path       string
		wantCSP    bool
		description string
	}{
		{
			name:       "API endpoint /rooms gets CSP",
			path:       "/rooms",
			wantCSP:    true,
			description: "API endpoints should have restrictive CSP",
		},
		{
			name:       "API endpoint /rooms/ gets CSP",
			path:       "/rooms/",
			wantCSP:    true,
			description: "API endpoints should have restrictive CSP",
		},
		{
			name:       "WebSocket endpoint gets CSP",
			path:       "/ws",
			wantCSP:    true,
			description: "WebSocket endpoints should have restrictive CSP",
		},
		{
			name:       "Admin endpoint gets CSP",
			path:       "/admin/rooms",
			wantCSP:    true,
			description: "Admin endpoints should have restrictive CSP",
		},
		{
			name:       "Health check gets CSP",
			path:       "/healthz",
			wantCSP:    true,
			description: "Health endpoint should have restrictive CSP",
		},
		{
			name:       "Upload endpoint gets CSP",
			path:       "/upload",
			wantCSP:    true,
			description: "Upload endpoint should have restrictive CSP",
		},
		{
			name:       "Root path no CSP",
			path:       "/",
			wantCSP:    false,
			description: "SPA root should not have CSP to allow JS/CSS loading",
		},
		{
			name:       "Client-side route no CSP",
			path:       "/some-spa-route",
			wantCSP:    false,
			description: "SPA routes should not have CSP to allow JS/CSS loading",
		},
		{
			name:       "Client-side room route no CSP",
			path:       "/room/abc123",
			wantCSP:    false,
			description: "Client-side room routes should not have CSP to allow JS/CSS loading",
		},
		{
			name:       "Uploads directory no CSP",
			path:       "/uploads/test.png",
			wantCSP:    false,
			description: "Static file serving should not have CSP",
		},
		{
			name:       "Assets directory no CSP",
			path:       "/assets/style.css",
			wantCSP:    false,
			description: "Asset serving should not have CSP",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			csp := w.Header().Get("Content-Security-Policy")
			hasCSP := csp != ""

			if hasCSP != tt.wantCSP {
				t.Errorf("%s: got CSP=%v, want CSP=%v. CSP value: %q",
					tt.description, hasCSP, tt.wantCSP, csp)
			}

			// Verify other security headers are always present
			if w.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Error("X-Content-Type-Options header missing or incorrect")
			}
			if w.Header().Get("X-Frame-Options") != "DENY" {
				t.Error("X-Frame-Options header missing or incorrect")
			}
			if w.Header().Get("X-XSS-Protection") != "1; mode=block" {
				t.Error("X-XSS-Protection header missing or incorrect")
			}
			if w.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
				t.Error("Referrer-Policy header missing or incorrect")
			}

			// If CSP is present, verify it's the correct restrictive policy
			if hasCSP && csp != "default-src 'none'; frame-ancestors 'none'" {
				t.Errorf("CSP header has wrong value: %q", csp)
			}
		})
	}
}

func TestIsAPIEndpoint(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/rooms", true},
		{"/rooms/", true},
		{"/rooms/abc123", true},
		{"/rooms/abc123/images", true},
		{"/ws", true},
		{"/ws/", true},
		{"/ws/rooms/abc", true},
		{"/admin", true},
		{"/admin/rooms", true},
		{"/healthz", true},
		{"/upload", true},
		{"/", false},
		{"/about", false},
		{"/contact", false},
		{"/room/abc", false},      // Client-side route (singular "room")
		{"/game/xyz", false},
		{"/uploads/image.png", false},
		{"/assets/style.css", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := isAPIEndpoint(tt.path)
			if got != tt.want {
				t.Errorf("isAPIEndpoint(%q) = %v, want %v", tt.path, got, tt.want)
			}
		})
	}
}
