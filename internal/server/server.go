package server

import (
	"bufio"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"log/slog"
	"regexp"
	"sync"
)

// Server wraps HTTP handlers and configuration.
type Server struct {
	cfg             Config
	logger          *slog.Logger
	mux             *http.ServeMux
	allowedOrigins  []string
	allowAllOrigins bool
	db              *sql.DB
	wsRooms         map[string]map[*wsConn]clientProfile
	gmRooms         map[string]*wsConn
	wsMu            sync.Mutex
}

// New constructs a Server with routes and middleware configured.
func New(cfg Config) (*Server, error) {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{AddSource: true}))

	if err := ensureDir(cfg.UploadDir); err != nil {
		return nil, fmt.Errorf("ensure uploads directory: %w", err)
	}

	db, err := openDatabase(cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	srv := &Server{
		cfg:            cfg,
		logger:         logger,
		mux:            http.NewServeMux(),
		allowedOrigins: cfg.AllowedOrigins,
		db:             db,
		wsRooms:        make(map[string]map[*wsConn]clientProfile),
		gmRooms:        make(map[string]*wsConn),
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

// Router exposes the configured mux with middleware applied.
func (s *Server) Router() http.Handler {
	return s.withCORS(s.loggingMiddleware(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("/healthz", s.handleHealth)
	s.mux.HandleFunc("/upload", s.handleUpload)
	s.mux.HandleFunc("/ws", s.handleWebsocket)
	s.mux.HandleFunc("/ws/", s.handleWebsocket) // allow room-scoped websocket paths
	s.mux.HandleFunc("/admin/rooms", s.handleAdminRooms)
	s.mux.HandleFunc("/admin/rooms/", s.handleAdminRoom)
	s.mux.HandleFunc("/rooms/join", s.handleRoomJoin)
	s.mux.HandleFunc("/rooms", s.handleRooms)
	s.mux.HandleFunc("/rooms/slug/", s.handleRoomLookup)
	s.mux.HandleFunc("/rooms/", s.handleRoom)
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
	RoomID    string    `json:"roomId"`
	URL       string    `json:"url"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
	X         float64   `json:"x"`
	Y         float64   `json:"y"`
}

type diceLogEntry struct {
	ID          string    `json:"id"`
	RoomID      string    `json:"roomId"`
	Seed        uint32    `json:"seed"`
	Count       int       `json:"count"`
	Results     []int     `json:"results"`
	TriggeredBy string    `json:"triggeredBy"`
	Timestamp   time.Time `json:"timestamp"`
}

type clientProfile struct {
	Name string `json:"name"`
	Role string `json:"role"`
}

func (s *Server) handleRooms(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var payload struct {
			Name      string `json:"name"`
			CreatedBy string `json:"createdBy"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid request", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(payload.Name)
		if name == "" {
			name = "Untitled room"
		}
		createdBy := strings.TrimSpace(payload.CreatedBy)
		room, err := s.createRoom(name, createdBy)
		if err != nil {
			s.logger.Error("create room", slog.String("error", err.Error()))
			http.Error(w, "failed to create room", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusCreated, room)
	case http.MethodGet:
		rooms, err := s.listRooms()
		if err != nil {
			s.logger.Error("list rooms", slog.String("error", err.Error()))
			http.Error(w, "failed to list rooms", http.StatusInternalServerError)
			return
		}
		writeJSON(w, http.StatusOK, rooms)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleAdminRooms(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	rooms, err := s.listAdminRooms()
	if err != nil {
		s.logger.Error("list admin rooms", slog.String("error", err.Error()))
		http.Error(w, "failed to list rooms", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, rooms)
}

func (s *Server) handleAdminRoom(w http.ResponseWriter, r *http.Request) {
	identifier := strings.Trim(strings.TrimPrefix(r.URL.Path, "/admin/rooms"), "/")
	if identifier == "" {
		http.NotFound(w, r)
		return
	}

	roomID, ok, err := s.resolveRoomID(identifier)
	if err != nil {
		s.logger.Error("resolve room for admin", slog.String("error", err.Error()))
		http.Error(w, "failed to resolve room", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodDelete:
		deleted, err := s.deleteRoom(roomID)
		if err != nil {
			s.logger.Error("delete room", slog.String("roomId", roomID), slog.String("error", err.Error()))
			http.Error(w, "failed to delete room", http.StatusInternalServerError)
			return
		}
		if !deleted {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleRoomLookup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	slug := strings.Trim(strings.TrimPrefix(r.URL.Path, "/rooms/slug"), "/")
	if slug == "" {
		http.NotFound(w, r)
		return
	}

	room, ok, err := s.getRoomBySlug(slug)
	if err != nil {
		s.logger.Error("lookup room", slog.String("error", err.Error()))
		http.Error(w, "failed to lookup room", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.NotFound(w, r)
		return
	}

	writeJSON(w, http.StatusOK, room)
}

func (s *Server) handleRoomJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		Slug string `json:"slug"`
		Name string `json:"name"`
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	slug := strings.TrimSpace(payload.Slug)
	name := strings.TrimSpace(payload.Name)
	role := strings.ToLower(strings.TrimSpace(payload.Role))
	if role == "" {
		role = string(RolePlayer)
	}

	if slug == "" {
		http.Error(w, "room slug is required", http.StatusBadRequest)
		return
	}

	if !isValidName(name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "name must be 2-32 characters and include only letters, numbers, spaces, hyphens, underscores, or apostrophes"})
		return
	}
	if role != string(RolePlayer) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only player role is supported when joining"})
		return
	}

	room, ok, err := s.getRoomBySlug(slug)
	if err != nil {
		s.logger.Error("lookup room for join", slog.String("error", err.Error()))
		http.Error(w, "failed to lookup room", http.StatusInternalServerError)
		return
	}
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "room not found"})
		return
	}

	player, err := s.createPlayer(room.ID, name, Role(role))
	if errors.Is(err, errRoomFull) {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "room full"})
		return
	}
	if err != nil {
		s.logger.Error("create player", slog.String("error", err.Error()))
		http.Error(w, "failed to join room", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"roomId":   room.ID,
		"roomSlug": room.Slug,
		"player":   player,
	})
}

func (s *Server) handleRoom(w http.ResponseWriter, r *http.Request) {
	trimmed := strings.Trim(strings.TrimPrefix(r.URL.Path, "/rooms/"), "/")
	parts := strings.Split(trimmed, "/")
	if len(parts) < 2 || parts[0] == "" {
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			s.spaHandler().ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
		return
	}
	roomID, ok, err := s.resolveRoomID(parts[0])
	if err != nil {
		s.logger.Error("resolve room", slog.String("error", err.Error()))
		http.Error(w, "failed to resolve room", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.NotFound(w, r)
		return
	}

	switch parts[1] {
	case "gm":
		if len(parts) != 2 {
			http.NotFound(w, r)
			return
		}
		s.handleRoomGM(w, r, roomID)
		return
	case "images":
		// continue
	case "dice":
		// continue
	default:
		http.NotFound(w, r)
		return
	}

	if len(parts) == 2 {
		switch r.Method {
		case http.MethodGet:
			if parts[1] == "dice" {
				logs, err := s.getDiceLogs(roomID)
				if err != nil {
					s.logger.Error("get dice logs", slog.String("error", err.Error()))
					http.Error(w, "failed to load dice logs", http.StatusInternalServerError)
					return
				}
				writeJSON(w, http.StatusOK, logs)
				return
			}
			if parts[1] == "images" {
				images, err := s.getImages(roomID)
				if err != nil {
					s.logger.Error("get images", slog.String("error", err.Error()))
					http.Error(w, "failed to load images", http.StatusInternalServerError)
					return
				}
				writeJSON(w, http.StatusOK, images)
				return
			}
			http.NotFound(w, r)
			return
		case http.MethodPost:
			if parts[1] == "dice" {
				s.handleDiceLogCreate(w, r, roomID)
				return
			}
			if parts[1] == "images" {
				s.handleImageCreate(w, r, roomID)
				return
			}
			http.NotFound(w, r)
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

func (s *Server) handleRoomGM(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	writeJSON(w, http.StatusOK, map[string]bool{"active": s.isGMActive(roomID)})
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
		x, y, err := s.nextPosition(roomID)
		if err != nil {
			s.logger.Error("next position", slog.String("error", err.Error()))
			http.Error(w, "failed to store image", http.StatusInternalServerError)
			return
		}
		img := imageResponse{
			ID:        s.newID(),
			RoomID:    roomID,
			URL:       payload.URL,
			Status:    "done",
			CreatedAt: time.Now().UTC(),
			X:         x,
			Y:         y,
		}
		stored, err := s.storeImage(roomID, img)
		if err != nil {
			s.logger.Error("store image", slog.String("error", err.Error()))
			http.Error(w, "failed to store image", http.StatusInternalServerError)
			return
		}
		s.broadcastSharedImage(roomID, stored)
		writeJSON(w, http.StatusCreated, stored)
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
		x, y, err := s.nextPosition(roomID)
		if err != nil {
			http.Error(w, "failed to store image", http.StatusInternalServerError)
			return
		}
		img := imageResponse{
			ID:        s.newID(),
			RoomID:    roomID,
			URL:       url,
			Status:    "done",
			CreatedAt: time.Now().UTC(),
			X:         x,
			Y:         y,
		}
		stored, err := s.storeImage(roomID, img)
		if err != nil {
			http.Error(w, "failed to store image", http.StatusInternalServerError)
			return
		}
		uploaded = append(uploaded, stored)
		s.broadcastSharedImage(roomID, stored)
	}

	if len(uploaded) == 1 {
		writeJSON(w, http.StatusCreated, uploaded[0])
		return
	}
	writeJSON(w, http.StatusCreated, uploaded)
}

func (s *Server) handleImageDelete(w http.ResponseWriter, r *http.Request, roomID, imageID string) {
	img, ok, err := s.deleteImage(roomID, imageID)
	if err != nil {
		s.logger.Error("delete image", slog.String("error", err.Error()))
		http.Error(w, "failed to delete image", http.StatusInternalServerError)
		return
	}
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
	img, ok, err := s.updateImage(roomID, imageID, payload.X, payload.Y)
	if err != nil {
		s.logger.Error("update image", slog.String("error", err.Error()))
		http.Error(w, "failed to update image", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.NotFound(w, r)
		return
	}
	s.broadcastSharedImage(roomID, img)
	writeJSON(w, http.StatusOK, img)
}

func (s *Server) handleDiceLogCreate(w http.ResponseWriter, r *http.Request, roomID string) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}

	var payload struct {
		Seed        uint32     `json:"seed"`
		Count       int        `json:"count"`
		Results     []int      `json:"results"`
		TriggeredBy string     `json:"triggeredBy"`
		Timestamp   *time.Time `json:"timestamp"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}
	if payload.Count <= 0 || len(payload.Results) == 0 {
		http.Error(w, "missing fields", http.StatusBadRequest)
		return
	}

	ts := time.Now().UTC()
	if payload.Timestamp != nil {
		ts = payload.Timestamp.UTC()
	}

	entry := diceLogEntry{
		Seed:        payload.Seed,
		Count:       payload.Count,
		Results:     append([]int{}, payload.Results...),
		TriggeredBy: strings.TrimSpace(payload.TriggeredBy),
		Timestamp:   ts,
	}

	stored, err := s.storeDiceLog(roomID, entry)
	if err != nil {
		s.logger.Error("store dice log", slog.String("error", err.Error()))
		http.Error(w, "failed to store dice log", http.StatusInternalServerError)
		return
	}
	s.broadcastDiceLog(roomID, stored)
	writeJSON(w, http.StatusOK, stored)
}

func (s *Server) getImages(roomID string) ([]imageResponse, error) {
	rows, err := s.db.Query(`SELECT id, room_id, url, status, created_at, x, y FROM images WHERE room_id = ? ORDER BY created_at ASC, id ASC`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var images []imageResponse
	for rows.Next() {
		var img imageResponse
		if err := rows.Scan(&img.ID, &img.RoomID, &img.URL, &img.Status, &img.CreatedAt, &img.X, &img.Y); err != nil {
			return nil, err
		}
		img.CreatedAt = img.CreatedAt.UTC()
		images = append(images, img)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return images, nil
}

func (s *Server) getDiceLogs(roomID string) ([]diceLogEntry, error) {
	rows, err := s.db.Query(`SELECT id, room_id, seed, count, results, triggered_by, timestamp FROM dice_logs WHERE room_id = ? ORDER BY timestamp DESC, id DESC LIMIT 50`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []diceLogEntry
	for rows.Next() {
		var entry diceLogEntry
		var results string
		if err := rows.Scan(&entry.ID, &entry.RoomID, &entry.Seed, &entry.Count, &results, &entry.TriggeredBy, &entry.Timestamp); err != nil {
			return nil, err
		}
		entry.Timestamp = entry.Timestamp.UTC()
		if err := json.Unmarshal([]byte(results), &entry.Results); err != nil {
			return nil, err
		}
		logs = append(logs, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return logs, nil
}

func (s *Server) storeImage(roomID string, img imageResponse) (imageResponse, error) {
	img.RoomID = roomID
	if img.Status == "" {
		img.Status = "done"
	}
	if img.CreatedAt.IsZero() {
		img.CreatedAt = time.Now().UTC()
	}
	_, err := s.db.Exec(
		`INSERT INTO images (id, room_id, url, status, created_at, x, y) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		img.ID, img.RoomID, img.URL, img.Status, img.CreatedAt, img.X, img.Y,
	)
	return img, err
}

func (s *Server) storeDiceLog(roomID string, entry diceLogEntry) (diceLogEntry, error) {
	if entry.TriggeredBy == "" {
		entry.TriggeredBy = "Okänd"
	}
	entry.Timestamp = entry.Timestamp.UTC()
	entry.RoomID = roomID
	resultsJSON, err := json.Marshal(entry.Results)
	if err != nil {
		return diceLogEntry{}, err
	}

	var existing diceLogEntry
	var existingResults string
	err = s.db.QueryRow(
		`SELECT id, room_id, seed, count, results, triggered_by, timestamp FROM dice_logs WHERE room_id = ? AND seed = ? AND count = ? AND results = ? LIMIT 1`,
		roomID, entry.Seed, entry.Count, string(resultsJSON),
	).Scan(&existing.ID, &existing.RoomID, &existing.Seed, &existing.Count, &existingResults, &existing.TriggeredBy, &existing.Timestamp)
	switch {
	case err == nil:
		if err := json.Unmarshal([]byte(existingResults), &existing.Results); err != nil {
			return diceLogEntry{}, err
		}
		existing.Timestamp = existing.Timestamp.UTC()
		return existing, nil
	case !errors.Is(err, sql.ErrNoRows):
		return diceLogEntry{}, err
	}

	entry.ID = s.newID()
	if _, err := s.db.Exec(
		`INSERT INTO dice_logs (id, room_id, seed, count, results, triggered_by, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		entry.ID, roomID, entry.Seed, entry.Count, string(resultsJSON), entry.TriggeredBy, entry.Timestamp,
	); err != nil {
		return diceLogEntry{}, err
	}

	// Trim to latest 50 entries
	if _, err := s.db.Exec(
		`DELETE FROM dice_logs WHERE id IN (
			SELECT id FROM dice_logs WHERE room_id = ? ORDER BY timestamp DESC, id DESC LIMIT -1 OFFSET 50
		)`,
		roomID,
	); err != nil {
		return diceLogEntry{}, err
	}

	return entry, nil
}

func (s *Server) nextPosition(roomID string) (float64, float64, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM images WHERE room_id = ?`, roomID).Scan(&count); err != nil {
		return 0, 0, err
	}
	offset := float64((count % 5) * 40)
	row := float64((count / 5) * 40)
	return offset, row, nil
}

func (s *Server) isGMActive(roomID string) bool {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()
	_, ok := s.gmRooms[roomID]
	return ok
}

func (s *Server) deleteImage(roomID, imageID string) (imageResponse, bool, error) {
	var img imageResponse
	err := s.db.QueryRow(
		`SELECT id, room_id, url, status, created_at, x, y FROM images WHERE id = ? AND room_id = ?`,
		imageID, roomID,
	).Scan(&img.ID, &img.RoomID, &img.URL, &img.Status, &img.CreatedAt, &img.X, &img.Y)
	if errors.Is(err, sql.ErrNoRows) {
		return imageResponse{}, false, nil
	}
	if err != nil {
		return imageResponse{}, false, err
	}
	if _, err := s.db.Exec(`DELETE FROM images WHERE id = ? AND room_id = ?`, imageID, roomID); err != nil {
		return imageResponse{}, false, err
	}
	return img, true, nil
}

func (s *Server) updateImage(roomID, imageID string, x, y *float64) (imageResponse, bool, error) {
	var img imageResponse
	err := s.db.QueryRow(
		`SELECT id, room_id, url, status, created_at, x, y FROM images WHERE id = ? AND room_id = ?`,
		imageID, roomID,
	).Scan(&img.ID, &img.RoomID, &img.URL, &img.Status, &img.CreatedAt, &img.X, &img.Y)
	if errors.Is(err, sql.ErrNoRows) {
		return imageResponse{}, false, nil
	}
	if err != nil {
		return imageResponse{}, false, err
	}
	if x != nil {
		img.X = *x
	}
	if y != nil {
		img.Y = *y
	}
	if _, err := s.db.Exec(`UPDATE images SET x = ?, y = ? WHERE id = ? AND room_id = ?`, img.X, img.Y, imageID, roomID); err != nil {
		return imageResponse{}, false, err
	}
	return img, true, nil
}

func (s *Server) createRoom(name, createdBy string) (Room, error) {
	if createdBy == "" {
		createdBy = "anonymous"
	}

	var room Room
	for attempt := 0; attempt < 5; attempt++ {
		slug, err := s.newSlug()
		if err != nil {
			return Room{}, err
		}
		room = Room{
			ID:        s.newID(),
			Slug:      slug,
			Name:      name,
			CreatedBy: createdBy,
			CreatedAt: time.Now().UTC(),
		}
		result, err := s.db.Exec(
			`INSERT OR IGNORE INTO rooms (id, slug, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
			room.ID, room.Slug, room.Name, room.CreatedBy, room.CreatedAt,
		)
		if err != nil {
			return Room{}, err
		}
		if rows, _ := result.RowsAffected(); rows > 0 {
			if err := s.ensureRoomActivity(room.ID, room.CreatedAt); err != nil {
				return Room{}, err
			}
			return room, nil
		}
	}

	return Room{}, errors.New("failed to generate unique room slug")
}

func (s *Server) listRooms() ([]Room, error) {
	rows, err := s.db.Query(`SELECT id, slug, name, created_by, created_at FROM rooms ORDER BY created_at DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rooms []Room
	for rows.Next() {
		var room Room
		if err := rows.Scan(&room.ID, &room.Slug, &room.Name, &room.CreatedBy, &room.CreatedAt); err != nil {
			return nil, err
		}
		room.CreatedAt = room.CreatedAt.UTC()
		rooms = append(rooms, room)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return rooms, nil
}

func (s *Server) ensureRoomActivity(roomID string, createdAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT OR IGNORE INTO room_activity (room_id, last_used_at, total_active_seconds, active_since) VALUES (?, ?, 0, NULL)`,
		roomID, createdAt,
	)
	return err
}

func (s *Server) markRoomActive(roomID string, now time.Time) error {
	if err := s.ensureRoomActivity(roomID, now); err != nil {
		return err
	}
	_, err := s.db.Exec(
		`UPDATE room_activity SET last_used_at = ?, active_since = COALESCE(active_since, ?) WHERE room_id = ?`,
		now, now, roomID,
	)
	return err
}

func (s *Server) markRoomInactive(roomID string, now time.Time) error {
	if err := s.ensureRoomActivity(roomID, now); err != nil {
		return err
	}

	var totalSeconds int64
	var activeSince sql.NullTime
	if err := s.db.QueryRow(`SELECT total_active_seconds, active_since FROM room_activity WHERE room_id = ?`, roomID).
		Scan(&totalSeconds, &activeSince); err != nil {
		return err
	}

	if activeSince.Valid {
		elapsed := now.Sub(activeSince.Time.UTC())
		if elapsed < 0 {
			elapsed = 0
		}
		totalSeconds += int64(elapsed.Seconds())
	}

	_, err := s.db.Exec(
		`UPDATE room_activity SET total_active_seconds = ?, active_since = NULL, last_used_at = ? WHERE room_id = ?`,
		totalSeconds, now, roomID,
	)
	return err
}

func (s *Server) getRoomActivities() (map[string]RoomActivity, error) {
	rows, err := s.db.Query(`SELECT room_id, last_used_at, total_active_seconds, active_since FROM room_activity`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	activities := make(map[string]RoomActivity)
	for rows.Next() {
		var roomID string
		var lastUsed sql.NullTime
		var activeSince sql.NullTime
		var totalSeconds int64
		if err := rows.Scan(&roomID, &lastUsed, &totalSeconds, &activeSince); err != nil {
			return nil, err
		}

		activity := RoomActivity{TotalActiveSeconds: totalSeconds}
		if lastUsed.Valid {
			ts := lastUsed.Time.UTC()
			activity.LastUsedAt = &ts
		}
		if activeSince.Valid {
			ts := activeSince.Time.UTC()
			activity.ActiveSince = &ts
		}
		activities[roomID] = activity
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return activities, nil
}

func (s *Server) snapshotConnections() (map[string][]clientProfile, map[string]bool) {
	s.wsMu.Lock()
	defer s.wsMu.Unlock()

	connections := make(map[string][]clientProfile, len(s.wsRooms))
	gmActive := make(map[string]bool, len(s.gmRooms))
	for roomID, peers := range s.wsRooms {
		profiles := make([]clientProfile, 0, len(peers))
		for _, profile := range peers {
			profiles = append(profiles, profile)
		}
		connections[roomID] = profiles
	}
	for roomID := range s.gmRooms {
		gmActive[roomID] = true
	}
	return connections, gmActive
}

func (s *Server) calculateRoomDiskUsage(roomID string) (int64, error) {
	rows, err := s.db.Query(`SELECT url FROM images WHERE room_id = ?`, roomID)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var total int64
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err != nil {
			return 0, err
		}
		if strings.HasPrefix(url, "/uploads/") {
			filename := filepath.Base(url)
			filePath := filepath.Join(s.cfg.UploadDir, filename)
			info, err := os.Stat(filePath)
			if err != nil {
				if os.IsNotExist(err) {
					continue
				}
				return 0, err
			}
			if !info.IsDir() {
				total += info.Size()
			}
		}
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	return total, nil
}

func (s *Server) listAdminRooms() ([]AdminRoomSummary, error) {
	rooms, err := s.listRooms()
	if err != nil {
		return nil, err
	}

	activities, err := s.getRoomActivities()
	if err != nil {
		return nil, err
	}
	connections, gmActive := s.snapshotConnections()
	now := time.Now().UTC()

	summaries := make([]AdminRoomSummary, 0, len(rooms))
	for _, room := range rooms {
		activity := activities[room.ID]
		profiles := connections[room.ID]
		if profiles == nil {
			profiles = []clientProfile{}
		}
		active := len(profiles) > 0
		lastUsed := activity.LastUsedAt
		activeSince := activity.ActiveSince
		totalSeconds := activity.TotalActiveSeconds
		if active {
			currentTime := now
			lastUsed = &currentTime
			if activeSince != nil {
				totalSeconds += int64(now.Sub(*activeSince).Seconds())
			}
		}

		diskUsage, err := s.calculateRoomDiskUsage(room.ID)
		if err != nil {
			return nil, err
		}

		summaries = append(summaries, AdminRoomSummary{
			ID:                 room.ID,
			Slug:               room.Slug,
			Name:               room.Name,
			CreatedBy:          room.CreatedBy,
			CreatedAt:          room.CreatedAt,
			Active:             active,
			ActiveSince:        activeSince,
			LastUsedAt:         lastUsed,
			TotalActiveSeconds: totalSeconds,
			DiskUsageBytes:     diskUsage,
			ActiveUsers:        profiles,
			GMConnected:        gmActive[room.ID],
		})
	}

	sort.SliceStable(summaries, func(i, j int) bool {
		if summaries[i].Active == summaries[j].Active {
			var left time.Time
			if summaries[i].LastUsedAt != nil {
				left = *summaries[i].LastUsedAt
			}
			var right time.Time
			if summaries[j].LastUsedAt != nil {
				right = *summaries[j].LastUsedAt
			}
			if !left.Equal(right) {
				return left.After(right)
			}
			return summaries[i].CreatedAt.After(summaries[j].CreatedAt)
		}
		return summaries[i].Active
	})

	return summaries, nil
}

func (s *Server) getRoomBySlug(slug string) (Room, bool, error) {
	var room Room
	err := s.db.QueryRow(`SELECT id, slug, name, created_by, created_at FROM rooms WHERE slug = ?`, slug).
		Scan(&room.ID, &room.Slug, &room.Name, &room.CreatedBy, &room.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Room{}, false, nil
	}
	if err != nil {
		return Room{}, false, err
	}
	room.CreatedAt = room.CreatedAt.UTC()
	return room, true, nil
}

func (s *Server) resolveRoomID(identifier string) (string, bool, error) {
	var id string
	err := s.db.QueryRow(`SELECT id FROM rooms WHERE id = ?`, identifier).Scan(&id)
	if err == nil {
		return id, true, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", false, err
	}
	err = s.db.QueryRow(`SELECT id FROM rooms WHERE slug = ?`, identifier).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return id, true, nil
}

func (s *Server) deleteRoom(roomID string) (bool, error) {
	var urls []string
	rows, err := s.db.Query(`SELECT url FROM images WHERE room_id = ?`, roomID)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err != nil {
			return false, err
		}
		urls = append(urls, url)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}

	tx, err := s.db.BeginTx(context.Background(), nil)
	if err != nil {
		return false, err
	}
	result, err := tx.Exec(`DELETE FROM rooms WHERE id = ?`, roomID)
	if err != nil {
		tx.Rollback()
		return false, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		tx.Rollback()
		return false, err
	}
	if affected == 0 {
		tx.Rollback()
		return false, nil
	}
	if err := tx.Commit(); err != nil {
		return false, err
	}

	s.closeRoomConnections(roomID)

	for _, url := range urls {
		if strings.HasPrefix(url, "/uploads/") {
			filename := filepath.Base(url)
			_ = os.Remove(filepath.Join(s.cfg.UploadDir, filename))
		}
	}

	return true, nil
}

func (s *Server) closeRoomConnections(roomID string) {
	s.wsMu.Lock()
	peers := s.wsRooms[roomID]
	delete(s.wsRooms, roomID)
	delete(s.gmRooms, roomID)
	s.wsMu.Unlock()

	for conn := range peers {
		_ = writeCloseFrame(conn.conn, 1001)
		_ = conn.conn.Close()
	}
}

func (s *Server) newID() string {
	return strconv.FormatInt(time.Now().UnixNano(), 10)
}

func (s *Server) newToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func (s *Server) newSlug() (string, error) {
	for attempt := 0; attempt < 10; attempt++ {
		buf := make([]byte, 6)
		if _, err := rand.Read(buf); err != nil {
			return strconv.FormatInt(time.Now().UnixNano(), 36), nil
		}
		slug := base64.RawURLEncoding.EncodeToString(buf)
		exists, err := s.slugExists(slug)
		if err != nil {
			return "", err
		}
		if !exists {
			return slug, nil
		}
	}
	return "", errors.New("unable to generate unique slug")
}

func (s *Server) slugExists(slug string) (bool, error) {
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(1) FROM rooms WHERE slug = ?`, slug).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (s *Server) createPlayer(roomID, name string, role Role) (Player, error) {
	token, err := s.newToken()
	if err != nil {
		return Player{}, err
	}
	player := Player{
		ID:        s.newID(),
		RoomID:    roomID,
		Name:      name,
		Role:      role,
		Token:     token,
		CreatedAt: time.Now().UTC(),
	}

	result, err := s.db.ExecContext(
		context.Background(),
		`INSERT INTO players (id, room_id, name, token, role, created_at)
			SELECT ?, ?, ?, ?, ?, ?
			WHERE (SELECT COUNT(1) FROM players WHERE room_id = ?) < ?;`,
		player.ID, player.RoomID, player.Name, player.Token, player.Role, player.CreatedAt,
		roomID, s.cfg.MaxPlayersPerRoom,
	)
	if err != nil {
		return Player{}, err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return Player{}, err
	}
	if rowsAffected == 0 {
		return Player{}, errRoomFull
	}

	return player, nil
}

func (s *Server) countPlayers(roomID string) (int, error) {
	var count int
	err := s.db.QueryRow(`SELECT COUNT(1) FROM players WHERE room_id = ?`, roomID).Scan(&count)
	return count, err
}

var (
	errRoomFull = errors.New("room full")
	namePattern = regexp.MustCompile(`^[\p{L}\p{N}][\p{L}\p{N}\s'_-]{1,31}$`)
)

func isValidName(name string) bool {
	if name == "" {
		return false
	}
	if !namePattern.MatchString(name) {
		return false
	}
	return utf8.RuneCountInString(name) >= 2 && utf8.RuneCountInString(name) <= 32
}

type wsConn struct {
	conn    net.Conn
	mu      sync.Mutex
	profile clientProfile
}

func (c *wsConn) write(opcode byte, payload []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return writeFrame(c.conn, opcode, payload)
}

func detectContentType(file io.Reader, filename string) (string, error) {
	buf := make([]byte, 512)
	n, err := io.ReadFull(file, buf)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return "", err
	}
	mimeType := http.DetectContentType(buf[:n])
	if mimeType == "application/octet-stream" {
		ext := strings.ToLower(filepath.Ext(filename))
		if ext != "" {
			if detected := mime.TypeByExtension(ext); detected != "" {
				mimeType = detected
			}
		}
	}
	return mimeType, nil
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
	resolvedRoomID, ok, err := s.resolveRoomID(roomID)
	if err != nil {
		s.logger.Error("resolve room for websocket", slog.String("error", err.Error()))
		http.Error(w, "failed to resolve room", http.StatusInternalServerError)
		return
	}
	if !ok {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}
	roomID = resolvedRoomID

	origin := r.Header.Get("Origin")
	allowedOrigin := s.matchOrigin(origin)
	if allowedOrigin == "" {
		http.Error(w, "origin not allowed", http.StatusForbidden)
		return
	}

	role := strings.ToLower(r.URL.Query().Get("role"))
	if role == "" {
		role = string(RolePlayer)
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	if name == "" {
		name = "Okänd"
	}
	profile := clientProfile{Name: name, Role: role}

	if profile.Role == string(RoleGM) && s.isGMActive(roomID) {
		http.Error(w, "gm already active", http.StatusConflict)
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

	client := &wsConn{conn: conn, profile: profile}
	s.registerWS(roomID, profile, client)
	defer s.unregisterWS(roomID, profile, client)

	// Block until the read loop exits so cleanup executes reliably
	s.readLoop(roomID, client)
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

func (s *Server) registerWS(roomID string, profile clientProfile, conn *wsConn) {
	s.wsMu.Lock()
	if s.wsRooms[roomID] == nil {
		s.wsRooms[roomID] = make(map[*wsConn]clientProfile)
	}
	s.wsRooms[roomID][conn] = profile
	if profile.Role == string(RoleGM) {
		s.gmRooms[roomID] = conn
	}
	peers := len(s.wsRooms[roomID])
	s.wsMu.Unlock()

	if err := s.markRoomActive(roomID, time.Now().UTC()); err != nil {
		s.logger.Error("record room activity (connect)", slog.String("room", roomID), slog.String("error", err.Error()))
	}

	s.logger.Info("ws connected", slog.String("room", roomID), slog.Int("peers", peers))
	s.broadcastRoster(roomID)
}

func (s *Server) unregisterWS(roomID string, profile clientProfile, conn *wsConn) {
	s.wsMu.Lock()
	peers := s.wsRooms[roomID]
	if peers != nil {
		delete(peers, conn)
		if len(peers) == 0 {
			delete(s.wsRooms, roomID)
		}
	}
	if profile.Role == string(RoleGM) {
		if current, ok := s.gmRooms[roomID]; ok && current == conn {
			delete(s.gmRooms, roomID)
		}
	}
	remaining := len(peers)
	s.wsMu.Unlock()

	now := time.Now().UTC()
	if remaining == 0 {
		if err := s.markRoomInactive(roomID, now); err != nil {
			s.logger.Error("record room activity (disconnect)", slog.String("room", roomID), slog.String("error", err.Error()))
		}
	} else {
		if err := s.markRoomActive(roomID, now); err != nil {
			s.logger.Error("update room activity (disconnect)", slog.String("room", roomID), slog.String("error", err.Error()))
		}
	}

	s.logger.Info("ws disconnected", slog.String("room", roomID), slog.Int("peers", remaining))
	s.broadcastRoster(roomID)
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
			s.handleWSMessage(roomID, client, payload)
		}
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

func (s *Server) broadcastRoster(roomID string) {
	s.wsMu.Lock()
	peers := s.wsRooms[roomID]
	profiles := make([]clientProfile, 0, len(peers))
	conns := make([]*wsConn, 0, len(peers))
	for conn, profile := range peers {
		profiles = append(profiles, profile)
		conns = append(conns, conn)
	}
	s.wsMu.Unlock()

	payload, err := json.Marshal(map[string]any{
		"type": "RosterUpdate",
		"payload": map[string]any{
			"users": profiles,
		},
	})
	if err != nil {
		s.logger.Error("marshal roster", slog.String("error", err.Error()))
		return
	}

	s.logger.Info("broadcast roster", slog.String("room", roomID), slog.Int("peers", len(conns)))
	for _, c := range conns {
		if err := c.write(0x1, payload); err != nil {
			s.logger.Error("broadcast roster", slog.String("error", err.Error()))
		}
	}
}

func (s *Server) handleWSMessage(roomID string, sender *wsConn, data []byte) {
	var msg struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}
	if err := json.Unmarshal(data, &msg); err != nil {
		s.logger.Error("unmarshal ws message", slog.String("error", err.Error()))
		return
	}

	switch msg.Type {
	case "DiceRoll":
		var dicePayload DiceRollPayload
		if err := json.Unmarshal(msg.Payload, &dicePayload); err != nil {
			s.logger.Error("unmarshal dice roll", slog.String("error", err.Error()))
			return
		}
		if sender != nil {
			dicePayload.TriggeredBy = sender.profile.Name
		}
		if dicePayload.TriggeredBy == "" {
			dicePayload.TriggeredBy = "Okänd"
		}
		s.broadcastDiceRoll(roomID, dicePayload)
	}
}

func (s *Server) broadcastDiceRoll(roomID string, diceRoll DiceRollPayload) {
	payload, err := json.Marshal(map[string]any{
		"type":    "DiceRoll",
		"payload": diceRoll,
	})
	if err != nil {
		s.logger.Error("marshal dice roll", slog.String("error", err.Error()))
		return
	}
	s.logger.Info(
		"broadcast dice roll",
		slog.String("room", roomID),
		slog.Uint64("seed", uint64(diceRoll.Seed)),
		slog.Int("count", diceRoll.Count),
		slog.Int("sides", diceRoll.Sides),
		slog.String("triggeredBy", diceRoll.TriggeredBy),
	)
	s.broadcast(roomID, payload)
}

func (s *Server) broadcastDiceLog(roomID string, entry diceLogEntry) {
	payload, err := json.Marshal(map[string]any{
		"type":    "DiceLogEntry",
		"payload": entry,
	})
	if err != nil {
		s.logger.Error("marshal dice log", slog.String("error", err.Error()))
		return
	}
	s.broadcast(roomID, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
