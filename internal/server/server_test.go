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

func newTestServer(t *testing.T, uploadDir string) *Server {
	t.Helper()
	cfg := LoadConfig()
	cfg.UploadDir = uploadDir
	cfg.FrontendDir = uploadDir
	cfg.DBPath = filepath.Join(uploadDir, "test.db")
	srv, err := New(cfg)
	if err != nil {
		t.Fatalf("failed to create server: %v", err)
	}
	t.Cleanup(func() {
		_ = srv.Close()
	})
	return srv
}

func TestRoomAndImageLifecycle(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	// create room
	body, _ := json.Marshal(map[string]string{"name": "Test"})
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

func TestRoomPersistenceAcrossRestarts(t *testing.T) {
	dir := t.TempDir()
	srv := newTestServer(t, dir)
	router := srv.Router()

	body, _ := json.Marshal(map[string]string{"name": "Persistent Room"})
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
	body, _ := json.Marshal(map[string]string{"name": "WS Room"})
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
