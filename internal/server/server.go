package server

import (
	"bufio"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"log/slog"
	"sync"
)

// Server wraps HTTP handlers and configuration.
type Server struct {
	cfg             Config
	logger          *slog.Logger
	mux             *http.ServeMux
	allowedOrigins  []string
	allowAllOrigins bool
	images          map[string][]imageResponse
	mu              sync.RWMutex
	wsRooms         map[string]map[*wsConn]struct{}
	wsMu            sync.Mutex
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
		images:         make(map[string][]imageResponse),
		wsRooms:        make(map[string]map[*wsConn]struct{}),
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
	s.mux.HandleFunc("/ws/", s.handleWebsocket) // allow room-scoped websocket paths
	s.mux.HandleFunc("/rooms/", s.handleRoomImages)
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

// Hijack allows WebSocket handlers to upgrade the connection through the wrapped writer.
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	if h, ok := rw.ResponseWriter.(http.Hijacker); ok {
		return h.Hijack()
	}
	return nil, nil, errors.New("hijack not supported")
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

type imageResponse struct {
	ID        string    `json:"id"`
	URL       string    `json:"url"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
}

func (s *Server) handleRoomImages(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/rooms/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] != "images" {
		http.NotFound(w, r)
		return
	}
	roomID := parts[0]

	if len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, s.getImages(roomID))
			return
		case http.MethodPost:
			s.handleImageCreate(w, r, roomID)
			return
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
	}

	if len(parts) == 3 {
		imageID := parts[2]
		switch r.Method {
		case http.MethodDelete:
			s.handleImageDelete(w, r, roomID, imageID)
			return
		case http.MethodPatch:
			s.handleImageUpdate(w, r, roomID, imageID)
			return
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
	}

	http.NotFound(w, r)
}

func (s *Server) handleImageCreate(w http.ResponseWriter, r *http.Request, roomID string) {
	contentType := r.Header.Get("Content-Type")
	if strings.HasPrefix(contentType, "application/json") {
		var payload struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil || payload.URL == "" {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		x, y := s.nextPosition(roomID)
		img := imageResponse{
			ID:        s.newID(),
			URL:       payload.URL,
			Status:    "done",
			CreatedAt: time.Now(),
			X:         x,
			Y:         y,
		}
		s.storeImage(roomID, img)
		s.broadcastSharedImage(roomID, img)
		writeJSON(w, http.StatusOK, img)
		return
	}

	if err := r.ParseMultipartForm(s.cfg.MaxUploadSize); err != nil {
		http.Error(w, "failed to parse upload", http.StatusBadRequest)
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		http.Error(w, "file not found in request", http.StatusBadRequest)
		return
	}

	var uploaded []imageResponse
	for _, fh := range files {
		file, err := fh.Open()
		if err != nil {
			http.Error(w, "unable to open file", http.StatusBadRequest)
			return
		}

		safeName := filepath.Base(fh.Filename)
		uniqueName := fmt.Sprintf("%s-%s", s.newID(), safeName)
		destPath := filepath.Join(s.cfg.UploadDir, uniqueName)
		out, err := os.Create(destPath)
		if err != nil {
			file.Close()
			http.Error(w, "unable to save file", http.StatusInternalServerError)
			return
		}

		if _, err := io.Copy(out, file); err != nil {
			out.Close()
			file.Close()
			http.Error(w, "unable to write file", http.StatusInternalServerError)
			return
		}
		out.Close()
		file.Close()

		url := "/uploads/" + uniqueName
		x, y := s.nextPosition(roomID)
		img := imageResponse{
			ID:        s.newID(),
			URL:       url,
			Status:    "done",
			CreatedAt: time.Now(),
			X:         x,
			Y:         y,
		}
		s.storeImage(roomID, img)
		uploaded = append(uploaded, img)
		s.broadcastSharedImage(roomID, img)
	}

	if len(uploaded) == 1 {
		writeJSON(w, http.StatusOK, uploaded[0])
		return
	}
	writeJSON(w, http.StatusOK, uploaded)
}

func (s *Server) handleImageDelete(w http.ResponseWriter, r *http.Request, roomID, imageID string) {
	img, ok := s.deleteImage(roomID, imageID)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(img.URL, "/uploads/") {
		filename := filepath.Base(img.URL)
		_ = os.Remove(filepath.Join(s.cfg.UploadDir, filename))
	}
	s.broadcastImageDeleted(roomID, imageID)
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (s *Server) handleImageUpdate(w http.ResponseWriter, r *http.Request, roomID, imageID string) {
	var payload struct {
		X *float64 `json:"x"`
		Y *float64 `json:"y"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if payload.X == nil && payload.Y == nil {
		http.Error(w, "missing fields", http.StatusBadRequest)
		return
	}
	img, ok := s.updateImage(roomID, imageID, payload.X, payload.Y)
	if !ok {
		http.NotFound(w, r)
		return
	}
	s.broadcastSharedImage(roomID, img)
	writeJSON(w, http.StatusOK, img)
}

func (s *Server) getImages(roomID string) []imageResponse {
	s.mu.RLock()
	defer s.mu.RUnlock()
	images := s.images[roomID]
	if images == nil {
		return []imageResponse{}
	}
	return append([]imageResponse{}, images...)
}

func (s *Server) storeImage(roomID string, img imageResponse) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.images[roomID] = append(s.images[roomID], img)
}

func (s *Server) nextPosition(roomID string) (float64, float64) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	count := len(s.images[roomID])
	offset := float64((count % 5) * 40)
	row := float64((count / 5) * 40)
	return offset, row
}

func (s *Server) deleteImage(roomID, imageID string) (imageResponse, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	images := s.images[roomID]
	for idx, img := range images {
		if img.ID == imageID {
			s.images[roomID] = append(images[:idx], images[idx+1:]...)
			return img, true
		}
	}
	return imageResponse{}, false
}

func (s *Server) updateImage(roomID, imageID string, x, y *float64) (imageResponse, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	images := s.images[roomID]
	for idx, img := range images {
		if img.ID == imageID {
			if x != nil {
				img.X = *x
			}
			if y != nil {
				img.Y = *y
			}
			s.images[roomID][idx] = img
			return img, true
		}
	}
	return imageResponse{}, false
}

func (s *Server) newID() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

type wsConn struct {
	conn net.Conn
	mu   sync.Mutex
}

func (c *wsConn) write(opcode byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return writeFrame(c.conn, opcode, payload)
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

	// Expected paths: /ws/rooms/{roomId}
	// Extract {roomId} robustly
	path := strings.TrimPrefix(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	var roomID string
	if len(parts) >= 3 && parts[0] == "ws" && parts[1] == "rooms" && parts[2] != "" {
		roomID = parts[2]
	}
	if roomID == "" {
		http.Error(w, "missing room id", http.StatusBadRequest)
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

	client := &wsConn{conn: conn}
	s.registerWS(roomID, client)
	defer s.unregisterWS(roomID, client)

	go s.readLoop(roomID, client)

	// Keep the connection open until read loop exits
	select {}
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
}

func (s *Server) registerWS(roomID string, conn *wsConn) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	if s.wsRooms[roomID] == nil {
		s.wsRooms[roomID] = make(map[*wsConn]struct{})
	}
	s.wsRooms[roomID][conn] = struct{}{}
	s.logger.Info("ws connected", slog.String("room", roomID), slog.Int("peers", len(s.wsRooms[roomID])))
}

func (s *Server) unregisterWS(roomID string, conn *wsConn) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	peers := s.wsRooms[roomID]
	if peers == nil {
		return
	}
	delete(peers, conn)
	if len(peers) == 0 {
		delete(s.wsRooms, roomID)
	}
	s.logger.Info("ws disconnected", slog.String("room", roomID), slog.Int("peers", len(peers)))
}

func (s *Server) readLoop(roomID string, client *wsConn) {
	for {
		opcode, payload, err := readFrame(client.conn)
		if err != nil {
			return
		}
		switch opcode {
		case 0x8: // close
			_ = writeCloseFrame(client.conn, 1000)
			return
		case 0x9: // ping
			_ = client.write(0xA, []byte{})
		case 0x1: // text frame
			s.handleClientMessage(roomID, payload)
		}
	}
}

func (s *Server) handleClientMessage(roomID string, payload []byte) {
	var msg struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}

	if err := json.Unmarshal(payload, &msg); err != nil {
		s.logger.Error("parse ws message", slog.String("error", err.Error()))
		return
	}

	switch msg.Type {
	case "DiceRollRequest":
		var req struct {
			Count int `json:"count"`
		}
		if err := json.Unmarshal(msg.Payload, &req); err != nil {
			s.logger.Error("parse dice request", slog.String("error", err.Error()))
			return
		}

		if req.Count < 1 {
			req.Count = 1
		}
		if req.Count > 50 {
			req.Count = 50
		}

		seedBytes := make([]byte, 4)
		if _, err := rand.Read(seedBytes); err != nil {
			s.logger.Error("dice seed", slog.String("error", err.Error()))
			binary.BigEndian.PutUint32(seedBytes, uint32(time.Now().UnixNano()))
		}

		seed := int(binary.BigEndian.Uint32(seedBytes))

		payloadBytes, err := json.Marshal(map[string]any{
			"type": "DiceRoll",
			"payload": map[string]any{
				"count": req.Count,
				"seed":  seed,
			},
		})
		if err != nil {
			s.logger.Error("marshal dice roll", slog.String("error", err.Error()))
			return
		}

		s.broadcast(roomID, payloadBytes)
	}
}

func (s *Server) broadcastSharedImage(roomID string, img imageResponse) {
	payload, err := json.Marshal(map[string]any{
		"type":    "SharedImage",
		"payload": img,
	})
	if err != nil {
		s.logger.Error("marshal shared image", slog.String("error", err.Error()))
		return
	}
	s.broadcast(roomID, payload)
}

func (s *Server) broadcastImageDeleted(roomID, imageID string) {
	payload, err := json.Marshal(map[string]any{
		"type":    "SharedImageDeleted",
		"payload": map[string]string{"id": imageID},
	})
	if err != nil {
		s.logger.Error("marshal delete", slog.String("error", err.Error()))
		return
	}
	s.broadcast(roomID, payload)
}

func (s *Server) broadcast(roomID string, payload []byte) {
	s.wsMu.Lock()
	peers := s.wsRooms[roomID]
	// copy to avoid holding lock during writes
	conns := make([]*wsConn, 0, len(peers))
	for c := range peers {
		conns = append(conns, c)
	}
	s.wsMu.Unlock()
	s.logger.Info("broadcast", slog.String("room", roomID), slog.Int("peers", len(conns)))
	for _, c := range conns {
		if err := c.write(0x1, payload); err != nil {
			s.logger.Error("broadcast", slog.String("error", err.Error()))
		}
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
