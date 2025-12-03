package server

import (
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
}
