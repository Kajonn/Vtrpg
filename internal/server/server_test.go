package server

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime/multipart"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestDetectContentType(t *testing.T) {
	file := []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	tmp := &multipart.FileHeader{Filename: "image.png", Size: int64(len(file))}
	mimeType, err := detectContentType(nopFile{bytes.NewReader(file)}, tmp.Filename)
	if err != nil {
		t.Fatalf("detectContentType error: %v", err)
	}
	if mimeType != "image/png" {
		t.Fatalf("unexpected mime type: %s", mimeType)
	}
}

type nopFile struct {
	*bytes.Reader
}

func (nopFile) Close() error { return nil }

type sequenceReader struct {
	sequences [][]byte
	index     int
}

func (r *sequenceReader) Read(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	if r.index >= len(r.sequences) {
		for i := range p {
			p[i] = byte(r.index + i)
		}
		return len(p), nil
	}
	copy(p, r.sequences[r.index])
	r.index++
	return len(p), nil
}

func TestCreateRoomSlugUniqueness(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServer(t, dir)

	collisionBytes := []byte{1, 2, 3, 4, 5, 6}
	collisionSlug := base64.RawURLEncoding.EncodeToString(collisionBytes)
	_, err := srv.db.Exec(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
		"existing", collisionSlug, "Existing", "tester", time.Now().UTC())
	if err != nil {
		t.Fatalf("seed collision slug: %v", err)
	}

	originalReader := rand.Reader
	rand.Reader = &sequenceReader{
		sequences: [][]byte{
			collisionBytes,                 // first attempt collides
			[]byte{9, 9, 9, 9, 9, 9, 9, 9}, // second attempt succeeds
		},
	}
	t.Cleanup(func() { rand.Reader = originalReader })

	room, err := srv.createRoom("New Room", "tester")
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	if room.Slug == collisionSlug {
		t.Fatalf("expected new slug after collision, got %s", room.Slug)
	}

	var slugs []string
	rows, err := srv.db.Query(`SELECT slug FROM rooms ORDER BY created_at DESC, id DESC`)
	if err != nil {
		t.Fatalf("query slugs: %v", err)
	}
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			t.Fatalf("scan slug: %v", err)
		}
		slugs = append(slugs, slug)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("rows error: %v", err)
	}
	slugSet := make(map[string]struct{})
	for _, slug := range slugs {
		if _, exists := slugSet[slug]; exists {
			t.Fatalf("duplicate slug detected: %s", slug)
		}
		slugSet[slug] = struct{}{}
	}
}

func newTestServerWithConfig(t *testing.T, uploadDir string, mutate func(*Config)) *Server {
	t.Helper()
	cfg := LoadConfig()
	cfg.UploadDir = uploadDir
	cfg.FrontendDir = uploadDir
	cfg.DBPath = filepath.Join(uploadDir, "test.db")
	if mutate != nil {
		mutate(&cfg)
	}
	srv, err := New(cfg)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Close()
	})
	return srv
}

func newTestServer(t *testing.T, uploadDir string) *Server {
	return newTestServerWithConfig(t, uploadDir, nil)
}

func createRoomForTest(t *testing.T, router http.Handler) Room {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"name": "Joinable", "createdBy": "Test Creator"})
	req := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var room Room
	_ = json.NewDecoder(w.Body).Decode(&room)
	return room
}

func createLegacyRoomForTest(t *testing.T, srv *Server, name string) Room {
	t.Helper()

	slug, err := srv.newSlug()
	if err != nil {
		t.Fatalf("failed to generate slug: %v", err)
	}

	room := Room{
		ID:        srv.newID(),
		Slug:      slug,
		Name:      name,
		CreatedAt: time.Now().UTC(),
	}

	if _, err := srv.db.Exec(`INSERT INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
		room.ID, room.Slug, room.Name, room.CreatedBy, room.CreatedAt); err != nil {
		t.Fatalf("failed to insert legacy room: %v", err)
	}

	if err := srv.ensureRoomActivity(room.ID, room.CreatedAt); err != nil {
		t.Fatalf("failed to ensure room activity: %v", err)
	}

	return room
}

func TestGetRoomByID(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()
	room := createRoomForTest(t, router)

	t.Run("returns room info for existing room", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/"+room.ID, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var resp Room
		_ = json.NewDecoder(w.Body).Decode(&resp)
		if resp.ID != room.ID || resp.Slug != room.Slug {
			t.Fatalf("unexpected room info: got %+v, want %+v", resp, room)
		}
	})

	t.Run("returns room info by slug", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/"+room.Slug, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var resp Room
		_ = json.NewDecoder(w.Body).Decode(&resp)
		if resp.ID != room.ID {
			t.Fatalf("expected room ID %s, got %s", room.ID, resp.ID)
		}
	})

	t.Run("returns 404 for non-existent room", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/nonexistent", nil)
		req.Header.Set("Accept", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("serves SPA for non-existent room with HTML accept header", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/nonexistent", nil)
		req.Header.Set("Accept", "text/html")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		// Should serve the SPA (status 200) instead of 404
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200 (SPA served), got %d", w.Code)
		}
	})

	t.Run("returns 405 for non-GET methods", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("expected 405, got %d", w.Code)
		}
	})
}

func TestRoomJoin(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()
	room := createRoomForTest(t, router)

	joinBody, _ := json.Marshal(map[string]string{"slug": room.Slug, "name": "Player One"})
	req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(joinBody))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 join, got %d", w.Code)
	}
	var resp struct {
		RoomID   string `json:"roomId"`
		RoomSlug string `json:"roomSlug"`
		Player   Player `json:"player"`
	}
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp.RoomID != room.ID || resp.RoomSlug != room.Slug {
		t.Fatalf("unexpected room info: %+v", resp)
	}
	if resp.Player.ID == "" || resp.Player.Token == "" {
		t.Fatalf("expected player identifiers, got %+v", resp.Player)
	}
	if resp.Player.Role != RolePlayer {
		t.Fatalf("expected player role to be %s, got %s", RolePlayer, resp.Player.Role)
	}
}

func TestRoomJoinValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	room := createRoomForTest(t, router)

	t.Run("invalid name", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"slug": room.Slug, "name": "a"})
		req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("room not found", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"slug": "missing", "name": "Player Two"})
		req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", w.Code)
		}
	})

	t.Run("room full", func(t *testing.T) {
		dir := t.TempDir()
		fullSrv := newTestServerWithConfig(t, dir, func(cfg *Config) {
			cfg.MaxPlayersPerRoom = 1
		})
		fullRouter := fullSrv.Router()
		fullRoom := createRoomForTest(t, fullRouter)

		first, _ := json.Marshal(map[string]string{"slug": fullRoom.Slug, "name": "First"})
		req1 := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(first))
		w1 := httptest.NewRecorder()
		fullRouter.ServeHTTP(w1, req1)
		if w1.Code != http.StatusCreated {
			t.Fatalf("expected first join 201, got %d", w1.Code)
		}

		second, _ := json.Marshal(map[string]string{"slug": fullRoom.Slug, "name": "Second"})
		req2 := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(second))
		w2 := httptest.NewRecorder()
		fullRouter.ServeHTTP(w2, req2)
		if w2.Code != http.StatusConflict {
			t.Fatalf("expected 409 when room is full, got %d", w2.Code)
		}
	})

	t.Run("missing slug", func(t *testing.T) {
		body, _ := json.Marshal(map[string]string{"slug": "  ", "name": "Player Three"})
		req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 when slug is missing, got %d", w.Code)
		}
	})

	t.Run("unsupported role", func(t *testing.T) {
		// When a creator is recorded, only that creator can join as GM.
		createBody, _ := json.Marshal(map[string]string{"name": "Creator Locked", "createdBy": "Creator"})
		createReq := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(createBody))
		createW := httptest.NewRecorder()
		router.ServeHTTP(createW, createReq)
		if createW.Code != http.StatusCreated {
			t.Fatalf("expected 201 for room creation, got %d", createW.Code)
		}
		var created Room
		_ = json.NewDecoder(createW.Body).Decode(&created)

		body, _ := json.Marshal(map[string]string{"slug": created.Slug, "name": "Player Four", "role": "gm"})
		req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for non-creator trying to join as GM, got %d", w.Code)
		}
		var resp map[string]string
		_ = json.NewDecoder(w.Body).Decode(&resp)
		if resp["error"] == "" {
			t.Fatalf("expected error message for unsupported role")
		}
	})

	t.Run("creatorless room allows GM join", func(t *testing.T) {
		creatorless := createLegacyRoomForTest(t, srv, "Legacy Room")
		body, _ := json.Marshal(map[string]string{"slug": creatorless.Slug, "name": "Any GM", "role": "gm"})
		req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 for GM join when creator is unset, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			Player Player `json:"player"`
		}
		_ = json.NewDecoder(w.Body).Decode(&resp)
		if resp.Player.Role != RoleGM {
			t.Fatalf("expected GM role, got %s", resp.Player.Role)
		}
	})

	t.Run("creator can join as GM", func(t *testing.T) {
		// Create a room with a specific creator name
		createBody, _ := json.Marshal(map[string]string{"name": "Creator Room", "createdBy": "Creator Name"})
		createReq := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(createBody))
		createW := httptest.NewRecorder()
		router.ServeHTTP(createW, createReq)
		if createW.Code != http.StatusCreated {
			t.Fatalf("expected 201 for room creation, got %d", createW.Code)
		}
		var createdRoom Room
		_ = json.NewDecoder(createW.Body).Decode(&createdRoom)

		// Join as GM with the creator name
		joinBody, _ := json.Marshal(map[string]string{"slug": createdRoom.Slug, "name": "Creator Name", "role": "gm"})
		joinReq := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(joinBody))
		joinW := httptest.NewRecorder()
		router.ServeHTTP(joinW, joinReq)
		if joinW.Code != http.StatusCreated {
			t.Fatalf("expected 201 for creator joining as GM, got %d: %s", joinW.Code, joinW.Body.String())
		}
		var joinResp struct {
			RoomID   string `json:"roomId"`
			RoomSlug string `json:"roomSlug"`
			Player   Player `json:"player"`
		}
		_ = json.NewDecoder(joinW.Body).Decode(&joinResp)
		if joinResp.Player.Role != RoleGM {
			t.Fatalf("expected GM role, got %s", joinResp.Player.Role)
		}
	})
}

func TestRoomJoinCapacityIsAtomic(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServerWithConfig(t, dir, func(cfg *Config) {
		cfg.MaxPlayersPerRoom = 1
	})
	router := srv.Router()
	room := createRoomForTest(t, router)

	var wg sync.WaitGroup
	statuses := make(chan int, 2)
	for _, name := range []string{"First", "Second"} {
		wg.Add(1)
		go func(n string) {
			defer wg.Done()
			body, _ := json.Marshal(map[string]string{"slug": room.Slug, "name": n})
			req := httptest.NewRequest(http.MethodPost, "/rooms/join", bytes.NewReader(body))
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			statuses <- w.Code
		}(name)
	}
	wg.Wait()
	close(statuses)

	var created, conflicts int
	for code := range statuses {
		switch code {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			t.Fatalf("unexpected status code: %d", code)
		}
	}
	if created != 1 || conflicts != 1 {
		t.Fatalf("expected one successful join and one conflict, got created=%d conflicts=%d", created, conflicts)
	}

	count, err := srv.countPlayers(room.ID)
	if err != nil {
		t.Fatalf("failed to count players: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected exactly one player to be stored, got %d", count)
	}
}

func TestRoomAndImageLifecycle(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	// create room
	body, _ := json.Marshal(map[string]string{"name": "Test", "createdBy": "Test Creator"})
	req := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(body))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var room Room
	_ = json.NewDecoder(w.Body).Decode(&room)
	if room.Slug == "" {
		t.Fatalf("expected slug to be set")
	}

	lookupReq := httptest.NewRequest(http.MethodGet, "/rooms/slug/"+room.Slug, nil)
	lw := httptest.NewRecorder()
	router.ServeHTTP(lw, lookupReq)
	if lw.Code != http.StatusOK {
		t.Fatalf("expected 200 from lookup, got %d", lw.Code)
	}
	var lookedUp Room
	_ = json.NewDecoder(lw.Body).Decode(&lookedUp)
	if lookedUp.ID != room.ID {
		t.Fatalf("expected lookup id %s, got %s", room.ID, lookedUp.ID)
	}

	// upload image via URL using slug resolution
	imgBody, _ := json.Marshal(map[string]any{"url": "https://example.com/img.png"})
	imgReq := httptest.NewRequest(http.MethodPost, "/rooms/"+room.Slug+"/images", bytes.NewReader(imgBody))
	imgReq.Header.Set("Content-Type", "application/json")
	iw := httptest.NewRecorder()
	router.ServeHTTP(iw, imgReq)
	if iw.Code != http.StatusCreated {
		t.Fatalf("expected 201 from image upload, got %d", iw.Code)
	}

	// list
	listReq := httptest.NewRequest(http.MethodGet, "/rooms/"+room.Slug+"/images", nil)
	lw = httptest.NewRecorder()
	router.ServeHTTP(lw, listReq)
	if lw.Code != http.StatusOK {
		t.Fatalf("expected 200 from list, got %d", lw.Code)
	}
	var images []SharedImage
	_ = json.NewDecoder(lw.Body).Decode(&images)
	if len(images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(images))
	}
}

func TestRoomRoutesRejectUnknownRooms(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	unknownSlug := "missing-room"

	listReq := httptest.NewRequest(http.MethodGet, "/rooms/"+unknownSlug+"/images", nil)
	listW := httptest.NewRecorder()
	router.ServeHTTP(listW, listReq)
	if listW.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown room images, got %d", listW.Code)
	}

	wsReq := httptest.NewRequest(http.MethodGet, "/ws/rooms/"+unknownSlug, nil)
	wsW := httptest.NewRecorder()
	router.ServeHTTP(wsW, wsReq)
	if wsW.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown room websocket, got %d", wsW.Code)
	}
}

func TestRoomLookupBySlug(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	room := createRoomForTest(t, router)

	t.Run("returns room", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/slug/"+room.Slug, nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}
		var payload Room
		_ = json.NewDecoder(w.Body).Decode(&payload)
		if payload.ID != room.ID || payload.Slug != room.Slug {
			t.Fatalf("unexpected room payload: %+v", payload)
		}
	})

	t.Run("missing slug segment", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/rooms/slug/", nil)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for missing slug, got %d", w.Code)
		}
	})
}

func TestRoomPersistenceAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServer(t, dir)
	router := srv.Router()

	body, _ := json.Marshal(map[string]string{"name": "Persistent Room", "createdBy": "Test Creator"})
	createReq := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(body))
	createW := httptest.NewRecorder()
	router.ServeHTTP(createW, createReq)
	if createW.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", createW.Code)
	}
	var created Room
	_ = json.NewDecoder(createW.Body).Decode(&created)
	if created.ID == "" || created.Slug == "" {
		t.Fatalf("expected room to have id and slug, got %+v", created)
	}

	// Close the first server to simulate a restart.
	_ = srv.Close()

	// Start a new server using the same database path.
	srv2 := newTestServer(t, dir)
	router2 := srv2.Router()

	listReq := httptest.NewRequest(http.MethodGet, "/rooms", nil)
	listW := httptest.NewRecorder()
	router2.ServeHTTP(listW, listReq)
	if listW.Code != http.StatusOK {
		t.Fatalf("expected 200 listing rooms after restart, got %d", listW.Code)
	}
	var rooms []Room
	_ = json.NewDecoder(listW.Body).Decode(&rooms)
	if len(rooms) != 1 || rooms[0].ID != created.ID {
		t.Fatalf("expected persisted room %+v, got %+v", created, rooms)
	}

	lookupReq := httptest.NewRequest(http.MethodGet, "/rooms/slug/"+created.Slug, nil)
	lookupW := httptest.NewRecorder()
	router2.ServeHTTP(lookupW, lookupReq)
	if lookupW.Code != http.StatusOK {
		t.Fatalf("expected 200 when looking up persisted room, got %d", lookupW.Code)
	}
	var lookedUp Room
	_ = json.NewDecoder(lookupW.Body).Decode(&lookedUp)
	if lookedUp.ID != created.ID {
		t.Fatalf("expected persisted room id %s, got %s", created.ID, lookedUp.ID)
	}
}

func TestWebsocketBroadcast(t *testing.T) {
	uploadDir := t.TempDir()
	app := newTestServer(t, uploadDir)

	srv := httptest.NewServer(app.Router())
	defer srv.Close()

	// create room
	body, _ := json.Marshal(map[string]string{"name": "WS Room", "createdBy": "Test Creator"})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/rooms", bytes.NewReader(body))
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	defer resp.Body.Close()
	var room Room
	_ = json.NewDecoder(resp.Body).Decode(&room)

	serverURL, _ := url.Parse(srv.URL)
	conn, err := net.Dial("tcp", serverURL.Host)
	if err != nil {
		t.Fatalf("dial server: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	key := make([]byte, 16)
	_, _ = rand.Read(key)
	encodedKey := base64.StdEncoding.EncodeToString(key)
	fmt.Fprintf(conn, "GET /ws/rooms/%s?name=test HTTP/1.1\r\n", room.Slug)
	fmt.Fprintf(conn, "Host: %s\r\n", serverURL.Host)
	fmt.Fprint(conn, "Upgrade: websocket\r\n")
	fmt.Fprint(conn, "Connection: Upgrade\r\n")
	fmt.Fprintf(conn, "Sec-WebSocket-Key: %s\r\n", encodedKey)
	fmt.Fprint(conn, "Sec-WebSocket-Version: 13\r\n\r\n")

	respResp, err := http.ReadResponse(bufio.NewReader(conn), &http.Request{Method: http.MethodGet})
	if err != nil {
		t.Fatalf("handshake response: %v", err)
	}
	if respResp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("unexpected handshake status: %d", respResp.StatusCode)
	}

	recvCh := make(chan SharedImage, 1)
	errCh := make(chan error, 1)
	go func() {
		for {
			opcode, payload, err := readFrame(conn)
			if err != nil {
				errCh <- err
				return
			}
			if opcode != 0x1 {
				continue
			}
			var envelope struct {
				Type    string          `json:"type"`
				Payload json.RawMessage `json:"payload"`
			}
			if err := json.Unmarshal(payload, &envelope); err != nil {
				errCh <- err
				return
			}
			if envelope.Type != "SharedImage" {
				continue
			}
			var recv SharedImage
			if err := json.Unmarshal(envelope.Payload, &recv); err != nil {
				errCh <- err
				return
			}
			recvCh <- recv
			return
		}
	}()

	// upload via file
	filePath := filepath.Join(uploadDir, "test.png")
	_ = os.WriteFile(filePath, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, 0o644)

	buf := &bytes.Buffer{}
	mw := multipart.NewWriter(buf)
	part, _ := mw.CreateFormFile("file", "test.png")
	data, _ := os.ReadFile(filePath)
	part.Write(data)
	mw.Close()

	uploadReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/rooms/"+room.Slug+"/images", buf)
	uploadReq.Header.Set("Content-Type", mw.FormDataContentType())

	t.Log("sending upload request")
	uploadResp, err := srv.Client().Do(uploadReq)
	if err != nil {
		t.Fatalf("upload image: %v", err)
	}
	if uploadResp.StatusCode != http.StatusCreated {
		t.Fatalf("unexpected status: %d", uploadResp.StatusCode)
	}
	uploadResp.Body.Close()

	t.Log("waiting for event")
	select {
	case recv := <-recvCh:
		if recv.RoomID != room.ID {
			t.Fatalf("unexpected room id: %s", recv.RoomID)
		}
	case err := <-errCh:
		t.Fatalf("stream error: %v", err)
	case <-time.After(3 * time.Second):
		t.Fatalf("no event received")
	}
}

func TestEmptyCollectionsReturnArrays(t *testing.T) {
	t.Run("empty images returns array not null", func(t *testing.T) {
		srv := newTestServer(t, t.TempDir())
		router := srv.Router()
		room := createRoomForTest(t, router)

		req := httptest.NewRequest(http.MethodGet, "/rooms/"+room.ID+"/images", nil)
		req.Header.Set("Accept", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		// Check raw JSON to ensure it's [] not null
		body := w.Body.String()
		if body != "[]\n" && body != "[]" {
			t.Fatalf("expected empty array [], got %q", body)
		}

		// Verify it decodes as an empty slice
		var images []imageResponse
		if err := json.Unmarshal(w.Body.Bytes(), &images); err != nil {
			t.Fatalf("failed to decode images: %v", err)
		}
		if images == nil {
			t.Fatalf("expected non-nil slice, got nil")
		}
		if len(images) != 0 {
			t.Fatalf("expected empty slice, got %d items", len(images))
		}
	})

	t.Run("empty dice logs returns array not null", func(t *testing.T) {
		srv := newTestServer(t, t.TempDir())
		router := srv.Router()
		room := createRoomForTest(t, router)

		req := httptest.NewRequest(http.MethodGet, "/rooms/"+room.ID+"/dice", nil)
		req.Header.Set("Accept", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		// Check raw JSON
		body := w.Body.String()
		if body != "[]\n" && body != "[]" {
			t.Fatalf("expected empty array [], got %q", body)
		}

		// Verify it decodes as an empty slice
		var logs []diceLogEntry
		if err := json.Unmarshal(w.Body.Bytes(), &logs); err != nil {
			t.Fatalf("failed to decode dice logs: %v", err)
		}
		if logs == nil {
			t.Fatalf("expected non-nil slice, got nil")
		}
		if len(logs) != 0 {
			t.Fatalf("expected empty slice, got %d items", len(logs))
		}
	})

	t.Run("empty rooms list returns array not null", func(t *testing.T) {
		srv := newTestServer(t, t.TempDir())
		router := srv.Router()

		req := httptest.NewRequest(http.MethodGet, "/rooms", nil)
		req.Header.Set("Accept", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", w.Code)
		}

		// Check raw JSON
		body := w.Body.String()
		if body != "[]\n" && body != "[]" {
			t.Fatalf("expected empty array [], got %q", body)
		}

		// Verify it decodes as an empty slice
		var rooms []Room
		if err := json.Unmarshal(w.Body.Bytes(), &rooms); err != nil {
			t.Fatalf("failed to decode rooms: %v", err)
		}
		if rooms == nil {
			t.Fatalf("expected non-nil slice, got nil")
		}
		if len(rooms) != 0 {
			t.Fatalf("expected empty slice, got %d items", len(rooms))
		}
	})

	t.Run("multipart upload with no files returns array not null", func(t *testing.T) {
		srv := newTestServer(t, t.TempDir())
		router := srv.Router()
		room := createRoomForTest(t, router)

		buf := &bytes.Buffer{}
		mw := multipart.NewWriter(buf)
		// Don't add any files, just close the writer
		mw.Close()

		req := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID+"/images", buf)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		req.Header.Set("Accept", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)

		// This should fail with 400 (bad request) since no files were provided
		// but if we change the implementation to allow empty uploads,
		// we want to ensure it returns [] not null
		if w.Code == http.StatusCreated {
			body := w.Body.String()
			if body != "[]\n" && body != "[]" {
				t.Fatalf("expected empty array [] for no files, got %q", body)
			}
		}
	})
}
