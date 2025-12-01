package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var allowedMIMEs = map[string]string{
	"image/png":  ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
}

// App contains HTTP handlers and in-memory data.
type App struct {
	mu           sync.RWMutex
	rooms        map[string]*Room
	images       map[string][]SharedImage
	tokens       map[string]User
	uploadDir    string
	broadcasters map[string]*RoomHub
}

// NewApp constructs an App and ensures upload directory exists.
func NewApp(uploadDir string) (*App, error) {
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		return nil, err
	}

	return &App{
		rooms:        make(map[string]*Room),
		images:       make(map[string][]SharedImage),
		tokens:       make(map[string]User),
		uploadDir:    uploadDir,
		broadcasters: make(map[string]*RoomHub),
	}, nil
}

// Router sets up HTTP routes.
func (a *App) Router() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/login", a.handleLogin)
	mux.Handle("/rooms", a.requireAuth(RoleGM, http.HandlerFunc(a.handleCreateRoom)))
	mux.Handle("/rooms/", a.requireAuth(RolePlayer, http.HandlerFunc(a.handleRoomResource)))
	mux.Handle("/ws/rooms/", a.requireAuth(RolePlayer, http.HandlerFunc(a.handleWebsocket)))

	fileServer := http.FileServer(http.Dir(a.uploadDir))
	mux.Handle("/uploads/", http.StripPrefix("/uploads/", withNoDirListing(fileServer)))

	return loggingMiddleware(mux)
}

func withNoDirListing(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/") {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		next.ServeHTTP(w, r)
	})
}

func (a *App) handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var req struct {
		Name string `json:"name"`
		Role Role   `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.Role != RoleGM && req.Role != RolePlayer {
		writeError(w, http.StatusBadRequest, "invalid role")
		return
	}

	token := generateToken()
	user := User{ID: generateToken(), Name: req.Name, Role: req.Role, Token: token}

	a.mu.Lock()
	a.tokens[token] = user
	a.mu.Unlock()

	writeJSON(w, http.StatusOK, user)
}

func (a *App) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	user := userFromContext(r.Context())
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	room := &Room{ID: generateToken(), Name: req.Name, CreatedBy: user.ID, CreatedAt: time.Now()}

	a.mu.Lock()
	a.rooms[room.ID] = room
	a.mu.Unlock()

	writeJSON(w, http.StatusCreated, room)
}

func (a *App) handleRoomResource(w http.ResponseWriter, r *http.Request) {
	// Expect /rooms/{id}/...
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/rooms/"), "/")
	if len(parts) == 0 || parts[0] == "" {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}

	roomID := parts[0]
	if len(parts) == 1 {
		writeError(w, http.StatusNotFound, "resource not found")
		return
	}

	switch parts[1] {
	case "images":
		if r.Method == http.MethodPost {
			a.handleUploadImage(w, r, roomID)
			return
		}
		if r.Method == http.MethodGet {
			a.handleListImages(w, r, roomID)
			return
		}
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	default:
		writeError(w, http.StatusNotFound, "resource not found")
	}
}

func (a *App) handleUploadImage(w http.ResponseWriter, r *http.Request, roomID string) {
	user := userFromContext(r.Context())

	room, err := a.getRoom(roomID)
	if err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB max

	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(12 << 20); err != nil {
			writeError(w, http.StatusBadRequest, "invalid form")
			return
		}

		img, err := a.handleMultipartImage(r.MultipartForm, room)
		if err != nil {
			var status = http.StatusBadRequest
			if errors.Is(err, os.ErrNotExist) {
				status = http.StatusNotFound
			}
			writeError(w, status, err.Error())
			return
		}
		a.storeAndBroadcast(w, room, img)
		return
	}

	// JSON with URL
	var req struct {
		URL      string   `json:"url"`
		Position Position `json:"position"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if req.URL == "" {
		writeError(w, http.StatusBadRequest, "url required")
		return
	}

	img := SharedImage{
		ID:         generateToken(),
		RoomID:     room.ID,
		SourceType: "url",
		StorageURL: req.URL,
		CreatedBy:  user.ID,
		CreatedAt:  time.Now(),
		Position:   req.Position,
	}
	a.storeAndBroadcast(w, room, img)
}

func (a *App) handleMultipartImage(form *multipart.Form, room *Room) (SharedImage, error) {
	var img SharedImage
	files := form.File["file"]
	if len(files) == 0 {
		return img, errors.New("file required")
	}

	fileHeader := files[0]
	if fileHeader.Size > 10<<20 {
		return img, errors.New("file too large")
	}

	src, err := fileHeader.Open()
	if err != nil {
		return img, err
	}
	defer src.Close()

	mimeType, err := detectContentType(src, fileHeader.Filename)
	if err != nil {
		return img, err
	}

	ext, ok := allowedMIMEs[mimeType]
	if !ok {
		return img, fmt.Errorf("unsupported mime type: %s", mimeType)
	}

	filename := fmt.Sprintf("%s%s", generateToken(), ext)
	destPath := filepath.Join(a.uploadDir, filename)
	dest, err := os.Create(destPath)
	if err != nil {
		return img, err
	}
	defer dest.Close()

	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return img, err
	}
	if _, err := io.Copy(dest, io.LimitReader(src, 10<<20)); err != nil {
		return img, err
	}

	storageURL := "/uploads/" + filename
	img = SharedImage{
		ID:          generateToken(),
		RoomID:      room.ID,
		SourceType:  "file",
		StorageURL:  storageURL,
		StoragePath: destPath,
		CreatedBy:   room.CreatedBy,
		CreatedAt:   time.Now(),
	}
	return img, nil
}

func detectContentType(r multipart.File, filename string) (string, error) {
	var header [512]byte
	n, err := r.Read(header[:])
	if err != nil && !errors.Is(err, io.EOF) {
		return "", err
	}
	if _, err := r.Seek(0, io.SeekStart); err != nil {
		return "", err
	}

	mimeType := http.DetectContentType(header[:n])
	if mimeType == "application/octet-stream" {
		if ext := filepath.Ext(filename); ext != "" {
			if t := mime.TypeByExtension(ext); t != "" {
				mimeType = t
			}
		}
	}
	return mimeType, nil
}

func (a *App) storeAndBroadcast(w http.ResponseWriter, room *Room, img SharedImage) {
	a.mu.Lock()
	a.images[room.ID] = append(a.images[room.ID], img)
	hub := a.getHub(room.ID)
	a.mu.Unlock()

	hub.Broadcast(img)
	writeJSON(w, http.StatusCreated, img)
}

func (a *App) handleListImages(w http.ResponseWriter, r *http.Request, roomID string) {
	if _, err := a.getRoom(roomID); err != nil {
		writeError(w, http.StatusNotFound, "room not found")
		return
	}

	a.mu.RLock()
	defer a.mu.RUnlock()
	images := a.images[roomID]
	if len(images) > 50 {
		images = images[len(images)-50:]
	}
	writeJSON(w, http.StatusOK, images)
}

func (a *App) getRoom(id string) (*Room, error) {
	a.mu.RLock()
	defer a.mu.RUnlock()
	room, ok := a.rooms[id]
	if !ok {
		return nil, os.ErrNotExist
	}
	return room, nil
}

func generateToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// loggingMiddleware logs basic request metadata.
func loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
}
