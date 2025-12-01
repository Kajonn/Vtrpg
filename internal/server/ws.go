package server

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RoomHub broadcasts messages to streaming clients per room.
type RoomHub struct {
	mu      sync.Mutex
	clients map[chan SharedImage]struct{}
}

func newRoomHub() *RoomHub {
	return &RoomHub{clients: make(map[chan SharedImage]struct{})}
}

func (h *RoomHub) add() (chan SharedImage, func()) {
	ch := make(chan SharedImage, 1)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch, func() {
		h.mu.Lock()
		delete(h.clients, ch)
		close(ch)
		h.mu.Unlock()
	}
}

// Broadcast sends an image to all listeners.
func (h *RoomHub) Broadcast(img SharedImage) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.clients {
		select {
		case ch <- img:
		default:
		}
	}
}

func (a *App) getHub(roomID string) *RoomHub {
	hub, ok := a.broadcasters[roomID]
	if !ok {
		hub = newRoomHub()
		a.broadcasters[roomID] = hub
	}
	return hub
}

func (a *App) handleWebsocket(w http.ResponseWriter, r *http.Request) {
	// Server-Sent Events implementation on the WebSocket route.
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/ws/rooms/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}
	roomID := parts[0]

	if _, err := a.getRoom(roomID); err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	hub := a.getHub(roomID)
	ch, cleanup := hub.add()
	defer cleanup()

	enc := bufio.NewWriter(w)
	enc.WriteString(": connected\n\n")
	enc.Flush()
	flusher.Flush()
	notify := r.Context().Done()
	for {
		select {
		case img := <-ch:
			payload, _ := jsonMarshal(img)
			enc.WriteString("data: ")
			enc.Write(payload)
			enc.WriteString("\n\n")
			enc.Flush()
			flusher.Flush()
		case <-notify:
			return
		case <-time.After(30 * time.Second):
			enc.WriteString(": keepalive\n\n")
			enc.Flush()
			flusher.Flush()
		}
	}
}

func jsonMarshal(v interface{}) ([]byte, error) {
	buf := &strings.Builder{}
	enc := json.NewEncoder(buf)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	result := strings.TrimSpace(buf.String())
	return []byte(result), nil
}
