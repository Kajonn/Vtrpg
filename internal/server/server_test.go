package server

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
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

func TestRoomAndImageLifecycle(t *testing.T) {
	app, _ := NewApp(t.TempDir())
	gm := User{ID: "gm", Role: RoleGM, Token: "token-gm"}
	app.tokens[gm.Token] = gm

	// create room
	body, _ := json.Marshal(map[string]string{"name": "Test"})
	req := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+gm.Token)
	w := httptest.NewRecorder()
	app.Router().ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", w.Code)
	}
	var room Room
	_ = json.NewDecoder(w.Body).Decode(&room)

	// upload image via URL
	imgBody, _ := json.Marshal(map[string]any{"url": "https://example.com/img.png"})
	imgReq := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID+"/images", bytes.NewReader(imgBody))
	imgReq.Header.Set("Authorization", "Bearer "+gm.Token)
	iw := httptest.NewRecorder()
	app.Router().ServeHTTP(iw, imgReq)
	if iw.Code != http.StatusCreated {
		t.Fatalf("expected 201 from image upload, got %d", iw.Code)
	}

	// list
	listReq := httptest.NewRequest(http.MethodGet, "/rooms/"+room.ID+"/images", nil)
	listReq.Header.Set("Authorization", "Bearer "+gm.Token)
	lw := httptest.NewRecorder()
	app.Router().ServeHTTP(lw, listReq)
	if lw.Code != http.StatusOK {
		t.Fatalf("expected 200 from list, got %d", lw.Code)
	}
	var images []SharedImage
	_ = json.NewDecoder(lw.Body).Decode(&images)
	if len(images) != 1 {
		t.Fatalf("expected 1 image, got %d", len(images))
	}
}

func TestWebsocketBroadcast(t *testing.T) {
	uploadDir := t.TempDir()
	app, _ := NewApp(uploadDir)
	gm := User{ID: "gm", Role: RoleGM, Token: "token-gm"}
	app.tokens[gm.Token] = gm

	srv := httptest.NewServer(app.Router())
	defer srv.Close()

	// create room
	body, _ := json.Marshal(map[string]string{"name": "WS Room"})
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/rooms", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+gm.Token)
	resp, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("create room: %v", err)
	}
	defer resp.Body.Close()
	var room Room
	_ = json.NewDecoder(resp.Body).Decode(&room)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	streamReq, _ := http.NewRequestWithContext(ctx, http.MethodGet, srv.URL+"/ws/rooms/"+room.ID, nil)
	streamReq.Header.Set("Authorization", "Bearer "+gm.Token)
	streamResp, err := srv.Client().Do(streamReq)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	defer streamResp.Body.Close()
	reader := bufio.NewReader(streamResp.Body)

	// upload via file
	filePath := filepath.Join(uploadDir, "test.png")
	_ = os.WriteFile(filePath, []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, 0o644)

	buf := &bytes.Buffer{}
	mw := multipart.NewWriter(buf)
	part, _ := mw.CreateFormFile("file", "test.png")
	data, _ := os.ReadFile(filePath)
	part.Write(data)
	mw.Close()

	uploadReq, _ := http.NewRequest(http.MethodPost, srv.URL+"/rooms/"+room.ID+"/images", buf)
	uploadReq.Header.Set("Content-Type", mw.FormDataContentType())
	uploadReq.Header.Set("Authorization", "Bearer "+gm.Token)

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
	recvCh := make(chan SharedImage, 1)
	errCh := make(chan error, 1)
	go func() {
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				errCh <- err
				return
			}
			if strings.HasPrefix(line, "data: ") {
				var recv SharedImage
				if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "data: "))), &recv); err != nil {
					errCh <- err
					return
				}
				recvCh <- recv
				return
			}
		}
	}()

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
