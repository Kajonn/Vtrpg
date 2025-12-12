package server

import (
<<<<<<< ours
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
=======
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"log/slog"
)

// Server wraps HTTP handlers and configuration.
type Server struct {
	cfg             Config
	logger          *slog.Logger
	mux             *http.ServeMux
	allowedOrigins  []string
	allowAllOrigins bool
}

// New constructs a Server with routes and middleware configured.
func New(cfg Config) (*Server, error) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true}))

	if err := ensureDir(cfg.UploadDir); err != nil {
		return nil, fmt.Errorf("ensure uploads directory: %w", err)
	}

	srv := &Server{
		cfg:            cfg,
		logger:         logger,
		mux:            http.NewServeMux(),
		allowedOrigins: cfg.AllowedOrigins,
	}
	for _, origin := range cfg.AllowedOrigins {
		if origin == "*" {
			srv.allowAllOrigins = true
		}
	}

	srv.routes()
	return srv, nil
}

// Run starts the HTTP server.
func (s *Server) Run() error {
	addr := ":" + s.cfg.Port
	s.logger.Info("starting server", slog.String("addr", addr))
	handler := s.withCORS(s.loggingMiddleware(s.mux))
	return http.ListenAndServe(addr, handler)
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.handleHealth)
	s.mux.HandleFunc("/upload", s.handleUpload)
	s.mux.HandleFunc("/ws", s.handleWebsocket)
	s.mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir(s.cfg.UploadDir))))
	s.mux.Handle("/", s.spaHandler())
}

func (s *Server) loggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)
		s.logger.Info("request", slog.String("method", r.Method), slog.String("path", r.URL.Path), slog.Int("status", rw.status), slog.Duration("duration", time.Since(start)))
	})
}

func ensureDir(path string) error {
	if path == "" {
		return errors.New("path is empty")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	return nil
}

type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (s *Server) spaHandler() http.Handler {
	fs := http.Dir(s.cfg.FrontendDir)
	fileServer := http.FileServer(fs)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		urlPath := r.URL.Path
		if urlPath == "/" {
			fileServer.ServeHTTP(w, r)
			return
		}

		cleanPath := strings.TrimPrefix(path.Clean("/"+urlPath), "/")
		requested := filepath.Join(s.cfg.FrontendDir, cleanPath)
		if info, err := os.Stat(requested); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}

		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(`{"status":"ok"}`))
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadSize)
	if err := r.ParseMultipartForm(s.cfg.MaxUploadSize); err != nil {
		http.Error(w, "failed to parse upload", http.StatusBadRequest)
		s.logger.Error("parse upload", slog.String("error", err.Error()))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file not found in request", http.StatusBadRequest)
		s.logger.Error("missing file", slog.String("error", err.Error()))
		return
	}
	defer file.Close()

	safeName := filepath.Base(header.Filename)
	destPath := filepath.Join(s.cfg.UploadDir, safeName)
	out, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "unable to save file", http.StatusInternalServerError)
		s.logger.Error("create file", slog.String("error", err.Error()))
		return
	}
	defer out.Close()

	if _, err := io.Copy(out, file); err != nil {
		http.Error(w, "unable to write file", http.StatusInternalServerError)
		s.logger.Error("write file", slog.String("error", err.Error()))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_, _ = w.Write([]byte(fmt.Sprintf(`{"file":"%s"}`, safeName)))
}

func (s *Server) handleWebsocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	origin := r.Header.Get("Origin")
	allowedOrigin := s.matchOrigin(origin)
	if allowedOrigin == "" {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}

	if !hasHeaderToken(r.Header.Get("Connection"), "upgrade") || !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		http.Error(w, "upgrade required", http.StatusBadRequest)
		return
	}

	key := r.Header.Get("Sec-WebSocket-Key")
	if key == "" {
		http.Error(w, "missing websocket key", http.StatusBadRequest)
		return
	}

	accept := computeWebsocketAccept(key)
	headers := http.Header{
		"Upgrade":              {"websocket"},
		"Connection":           {"Upgrade"},
		"Sec-WebSocket-Accept": {accept},
	}
	if origin != "" {
		headers.Set("Access-Control-Allow-Origin", allowedOrigin)
		if allowedOrigin != "*" {
			headers.Set("Vary", "Origin")
		}
	}

	hijacker, ok := w.(http.Hijacker)
	if !ok {
		http.Error(w, "websocket not supported", http.StatusInternalServerError)
		return
	}

	conn, buf, err := hijacker.Hijack()
	if err != nil {
		s.logger.Error("hijack failed", slog.String("error", err.Error()))
		return
	}
	defer conn.Close()

	response := "HTTP/1.1 101 Switching Protocols\r\n"
	for key, vals := range headers {
		response += key + ": " + strings.Join(vals, ", ") + "\r\n"
	}
	response += "\r\n"

	if _, err := buf.WriteString(response); err != nil {
		s.logger.Error("write handshake", slog.String("error", err.Error()))
		return
	}
	if err := buf.Flush(); err != nil {
		s.logger.Error("flush handshake", slog.String("error", err.Error()))
		return
	}

	handleWebsocketEcho(conn, s.logger)
}

func hasHeaderToken(value, token string) bool {
	if value == "" {
		return false
	}

	token = strings.ToLower(token)
	for _, part := range strings.Split(value, ",") {
		if strings.TrimSpace(strings.ToLower(part)) == token {
			return true
		}
	}

	return false
}

func computeWebsocketAccept(key string) string {
	const magic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	h := sha1.Sum([]byte(key + magic))
	return base64.StdEncoding.EncodeToString(h[:])
>>>>>>> theirs
}
