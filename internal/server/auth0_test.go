package server

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// testLogger returns a logger that discards all output.
func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func TestAuth0TokenValidation(t *testing.T) {
	t.Run("invalid token format", func(t *testing.T) {
		cfg := Auth0Config{
			Domain:   "test.auth0.com",
			Audience: "test-audience",
		}
		logger := testLogger()
		m := newAuth0Middleware(cfg, logger)

		_, err := m.validateToken(context.Background(), "not-a-jwt")
		if err == nil {
			t.Error("expected error for invalid token format")
		}
		if !strings.Contains(err.Error(), "invalid token format") {
			t.Errorf("expected 'invalid token format' error, got: %v", err)
		}
	})

	t.Run("invalid algorithm", func(t *testing.T) {
		cfg := Auth0Config{
			Domain:   "test.auth0.com",
			Audience: "test-audience",
		}
		logger := testLogger()
		m := newAuth0Middleware(cfg, logger)

		// Create a token with HS256 algorithm (unsupported)
		header := base64URLEncode([]byte(`{"alg":"HS256","typ":"JWT"}`))
		payload := base64URLEncode([]byte(`{"sub":"test"}`))
		token := header + "." + payload + ".signature"

		_, err := m.validateToken(context.Background(), token)
		if err == nil {
			t.Error("expected error for unsupported algorithm")
		}
		if !strings.Contains(err.Error(), "unsupported algorithm") {
			t.Errorf("expected 'unsupported algorithm' error, got: %v", err)
		}
	})

	t.Run("invalid issuer", func(t *testing.T) {
		cfg := Auth0Config{
			Domain:   "test.auth0.com",
			Audience: "test-audience",
		}
		logger := testLogger()
		m := newAuth0Middleware(cfg, logger)

		header := base64URLEncode([]byte(`{"alg":"RS256","typ":"JWT","kid":"test-kid"}`))
		payload := base64URLEncode([]byte(`{"iss":"https://wrong.auth0.com/","sub":"test","aud":"test-audience","exp":` + itoa(time.Now().Add(time.Hour).Unix()) + `,"iat":` + itoa(time.Now().Unix()) + `}`))
		token := header + "." + payload + ".signature"

		_, err := m.validateToken(context.Background(), token)
		if err == nil {
			t.Error("expected error for invalid issuer")
		}
		if !strings.Contains(err.Error(), "invalid issuer") {
			t.Errorf("expected 'invalid issuer' error, got: %v", err)
		}
	})

	t.Run("invalid audience", func(t *testing.T) {
		cfg := Auth0Config{
			Domain:   "test.auth0.com",
			Audience: "test-audience",
		}
		logger := testLogger()
		m := newAuth0Middleware(cfg, logger)

		header := base64URLEncode([]byte(`{"alg":"RS256","typ":"JWT","kid":"test-kid"}`))
		payload := base64URLEncode([]byte(`{"iss":"https://test.auth0.com/","sub":"test","aud":"wrong-audience","exp":` + itoa(time.Now().Add(time.Hour).Unix()) + `,"iat":` + itoa(time.Now().Unix()) + `}`))
		token := header + "." + payload + ".signature"

		_, err := m.validateToken(context.Background(), token)
		if err == nil {
			t.Error("expected error for invalid audience")
		}
		if !strings.Contains(err.Error(), "invalid audience") {
			t.Errorf("expected 'invalid audience' error, got: %v", err)
		}
	})

	t.Run("expired token", func(t *testing.T) {
		cfg := Auth0Config{
			Domain:   "test.auth0.com",
			Audience: "test-audience",
		}
		logger := testLogger()
		m := newAuth0Middleware(cfg, logger)

		header := base64URLEncode([]byte(`{"alg":"RS256","typ":"JWT","kid":"test-kid"}`))
		payload := base64URLEncode([]byte(`{"iss":"https://test.auth0.com/","sub":"test","aud":"test-audience","exp":` + itoa(time.Now().Add(-time.Hour).Unix()) + `,"iat":` + itoa(time.Now().Add(-2*time.Hour).Unix()) + `}`))
		token := header + "." + payload + ".signature"

		_, err := m.validateToken(context.Background(), token)
		if err == nil {
			t.Error("expected error for expired token")
		}
		if !strings.Contains(err.Error(), "token expired") {
			t.Errorf("expected 'token expired' error, got: %v", err)
		}
	})
}

func TestGMEndpointsWithoutAuth0(t *testing.T) {
	cfg := LoadConfig()
	cfg.DBPath = ":memory:"
	cfg.UploadDir = t.TempDir()
	// Auth0 not configured
	cfg.Auth0Domain = ""
	cfg.Auth0Audience = ""

	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	t.Run("GET /gm/rooms without Auth0 configured returns 503", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/gm/rooms", nil)
		req.Header.Set("Authorization", "Bearer fake-token")
		rr := httptest.NewRecorder()
		srv.Router().ServeHTTP(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", rr.Code)
		}
	})

	t.Run("POST /gm/rooms without Auth0 configured returns 503", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/gm/rooms", strings.NewReader(`{"name":"Test"}`))
		req.Header.Set("Authorization", "Bearer fake-token")
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.Router().ServeHTTP(rr, req)

		if rr.Code != http.StatusServiceUnavailable {
			t.Errorf("expected status 503, got %d", rr.Code)
		}
	})
}

func TestGMEndpointsRequireAuth(t *testing.T) {
	cfg := LoadConfig()
	cfg.DBPath = ":memory:"
	cfg.UploadDir = t.TempDir()
	cfg.Auth0Domain = "test.auth0.com"
	cfg.Auth0Audience = "test-audience"

	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	t.Run("GET /gm/rooms without token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/gm/rooms", nil)
		rr := httptest.NewRecorder()
		srv.Router().ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", rr.Code)
		}
	})

	t.Run("POST /gm/rooms without token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/gm/rooms", strings.NewReader(`{"name":"Test"}`))
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		srv.Router().ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", rr.Code)
		}
	})

	t.Run("GET /gm/rooms with invalid token returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/gm/rooms", nil)
		req.Header.Set("Authorization", "Bearer invalid-token")
		rr := httptest.NewRecorder()
		srv.Router().ServeHTTP(rr, req)

		if rr.Code != http.StatusUnauthorized {
			t.Errorf("expected status 401, got %d", rr.Code)
		}
	})
}

func TestListRoomsByCreatorSub(t *testing.T) {
	cfg := LoadConfig()
	cfg.DBPath = ":memory:"
	cfg.UploadDir = t.TempDir()

	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	// Create rooms with different creator subs
	room1, err := srv.createRoomWithSub("Room 1", "GM One", "auth0|user1")
	if err != nil {
		t.Fatal(err)
	}

	room2, err := srv.createRoomWithSub("Room 2", "GM One", "auth0|user1")
	if err != nil {
		t.Fatal(err)
	}

	_, err = srv.createRoomWithSub("Room 3", "GM Two", "auth0|user2")
	if err != nil {
		t.Fatal(err)
	}

	// List rooms for user1
	rooms, err := srv.listRoomsByCreatorSub("auth0|user1")
	if err != nil {
		t.Fatal(err)
	}

	if len(rooms) != 2 {
		t.Errorf("expected 2 rooms for user1, got %d", len(rooms))
	}

	// Check the rooms are the correct ones
	roomIDs := make(map[string]bool)
	for _, r := range rooms {
		roomIDs[r.ID] = true
	}

	if !roomIDs[room1.ID] {
		t.Errorf("expected room1 to be in list")
	}
	if !roomIDs[room2.ID] {
		t.Errorf("expected room2 to be in list")
	}

	// List rooms for user2
	rooms, err = srv.listRoomsByCreatorSub("auth0|user2")
	if err != nil {
		t.Fatal(err)
	}

	if len(rooms) != 1 {
		t.Errorf("expected 1 room for user2, got %d", len(rooms))
	}

	// List rooms for non-existent user
	rooms, err = srv.listRoomsByCreatorSub("auth0|user3")
	if err != nil {
		t.Fatal(err)
	}

	if len(rooms) != 0 {
		t.Errorf("expected 0 rooms for user3, got %d", len(rooms))
	}
}

func TestCreateRoomWithSub(t *testing.T) {
	cfg := LoadConfig()
	cfg.DBPath = ":memory:"
	cfg.UploadDir = t.TempDir()

	srv, err := New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()

	t.Run("creates room with Auth0 subject", func(t *testing.T) {
		room, err := srv.createRoomWithSub("Test Room", "Test GM", "auth0|12345")
		if err != nil {
			t.Fatal(err)
		}

		if room.Name != "Test Room" {
			t.Errorf("expected name 'Test Room', got '%s'", room.Name)
		}
		if room.CreatedBy != "Test GM" {
			t.Errorf("expected createdBy 'Test GM', got '%s'", room.CreatedBy)
		}
		if room.CreatedBySub != "auth0|12345" {
			t.Errorf("expected createdBySub 'auth0|12345', got '%s'", room.CreatedBySub)
		}
		if room.Slug == "" {
			t.Error("expected slug to be set")
		}
	})

	t.Run("room is retrievable by ID with subject", func(t *testing.T) {
		created, err := srv.createRoomWithSub("Another Room", "Another GM", "auth0|67890")
		if err != nil {
			t.Fatal(err)
		}

		retrieved, err := srv.getRoomByID(created.ID)
		if err != nil {
			t.Fatal(err)
		}

		if retrieved.CreatedBySub != "auth0|67890" {
			t.Errorf("expected createdBySub 'auth0|67890', got '%s'", retrieved.CreatedBySub)
		}
	})

	t.Run("room is retrievable by slug with subject", func(t *testing.T) {
		created, err := srv.createRoomWithSub("Slug Room", "Slug GM", "auth0|slug123")
		if err != nil {
			t.Fatal(err)
		}

		retrieved, ok, err := srv.getRoomBySlug(created.Slug)
		if err != nil {
			t.Fatal(err)
		}
		if !ok {
			t.Fatal("expected room to be found by slug")
		}

		if retrieved.CreatedBySub != "auth0|slug123" {
			t.Errorf("expected createdBySub 'auth0|slug123', got '%s'", retrieved.CreatedBySub)
		}
	})
}

func TestParseAudience(t *testing.T) {
	t.Run("string audience", func(t *testing.T) {
		aud := parseAudience("test-audience")
		if len(aud) != 1 || aud[0] != "test-audience" {
			t.Errorf("expected ['test-audience'], got %v", aud)
		}
	})

	t.Run("array audience", func(t *testing.T) {
		aud := parseAudience([]interface{}{"aud1", "aud2"})
		if len(aud) != 2 {
			t.Errorf("expected 2 audiences, got %d", len(aud))
		}
		if aud[0] != "aud1" || aud[1] != "aud2" {
			t.Errorf("expected ['aud1', 'aud2'], got %v", aud)
		}
	})

	t.Run("nil audience", func(t *testing.T) {
		aud := parseAudience(nil)
		if len(aud) != 0 {
			t.Errorf("expected empty slice, got %v", aud)
		}
	})
}

func TestContainsString(t *testing.T) {
	slice := []string{"a", "b", "c"}

	if !containsString(slice, "b") {
		t.Error("expected 'b' to be found in slice")
	}

	if containsString(slice, "d") {
		t.Error("expected 'd' not to be found in slice")
	}

	if containsString(nil, "a") {
		t.Error("expected empty slice to not contain 'a'")
	}
}

// Helper functions

func base64URLEncode(data []byte) string {
	encoded := base64URLEncodeBytes(data)
	// Remove padding
	return strings.TrimRight(encoded, "=")
}

func base64URLEncodeBytes(data []byte) string {
	return base64RawURLEncode(data)
}

func base64RawURLEncode(data []byte) string {
	const encodeURL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	if len(data) == 0 {
		return ""
	}
	var sb strings.Builder
	for i := 0; i < len(data); i += 3 {
		val := uint32(data[i]) << 16
		if i+1 < len(data) {
			val |= uint32(data[i+1]) << 8
		}
		if i+2 < len(data) {
			val |= uint32(data[i+2])
		}
		sb.WriteByte(encodeURL[(val>>18)&0x3F])
		sb.WriteByte(encodeURL[(val>>12)&0x3F])
		if i+1 < len(data) {
			sb.WriteByte(encodeURL[(val>>6)&0x3F])
		}
		if i+2 < len(data) {
			sb.WriteByte(encodeURL[val&0x3F])
		}
	}
	return sb.String()
}

func itoa(n int64) string {
	return json.Number(int64ToStr(n)).String()
}

func int64ToStr(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
