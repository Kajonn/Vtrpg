package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestWebSocketGMValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	// Create a room with a specific creator
	body, _ := json.Marshal(map[string]string{"name": "Test Room", "createdBy": "Alice"})
	req := httptest.NewRequest("POST", "/rooms", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != 201 {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var room Room
	_ = json.NewDecoder(w.Body).Decode(&room)

	t.Run("creator can connect as GM via WebSocket", func(t *testing.T) {
		// Try to connect as Alice (the creator) with GM role
		req := httptest.NewRequest("GET", fmt.Sprintf("/ws/rooms/%s?role=gm&name=Alice", room.ID), nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		// httptest doesn't support hijacking, so we get 200 instead of 101
		// But we should NOT get 403, which would mean validation failed
		if w.Code == 403 {
			t.Fatalf("creator should be allowed to connect as GM, got 403: %s", w.Body.String())
		}
	})

	t.Run("non-creator cannot connect as GM via WebSocket", func(t *testing.T) {
		// Try to connect as Bob (not the creator) with GM role
		req := httptest.NewRequest("GET", fmt.Sprintf("/ws/rooms/%s?role=gm&name=Bob", room.ID), nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		// Should get 403 Forbidden
		if w.Code != 403 {
			t.Fatalf("expected 403 for non-creator trying to connect as GM, got %d: %s", w.Code, w.Body.String())
		}
		expected := "only the room creator can connect as GM\n"
		if w.Body.String() != expected {
			t.Fatalf("expected error message %q, got %q", expected, w.Body.String())
		}
	})

	t.Run("anyone can connect as player via WebSocket", func(t *testing.T) {
		// Try to connect as Bob with player role
		req := httptest.NewRequest("GET", fmt.Sprintf("/ws/rooms/%s?role=player&name=Bob", room.ID), nil)
		req.Header.Set("Connection", "Upgrade")
		req.Header.Set("Upgrade", "websocket")
		req.Header.Set("Sec-WebSocket-Key", "dGhlIHNhbXBsZSBub25jZQ==")
		req.Header.Set("Sec-WebSocket-Version", "13")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		// Should not get 403
		if w.Code == 403 {
			t.Fatalf("player should be allowed to connect, got 403: %s", w.Body.String())
		}
	})
}
