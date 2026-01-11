package server

import (
	"bytes"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImageURLValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()
	room := createRoomForTest(t, router)

	tests := []struct {
		name       string
		url        string
		wantStatus int
	}{
		{
			name:       "valid http URL",
			url:        "http://example.com/image.png",
			wantStatus: http.StatusCreated,
		},
		{
			name:       "valid https URL",
			url:        "https://example.com/image.jpg",
			wantStatus: http.StatusCreated,
		},
		{
			name:       "reject javascript URL",
			url:        "javascript:alert('xss')",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject file URL",
			url:        "file:///etc/passwd",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject data URL",
			url:        "data:text/html,<script>alert('xss')</script>",
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject empty URL",
			url:        "",
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]string{"url": tt.url})
			req := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID+"/images", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("got status %d, want %d for URL %q", w.Code, tt.wantStatus, tt.url)
			}
		})
	}
}

func TestImagePositionValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()
	room := createRoomForTest(t, router)

	// First create an image to update
	body, _ := json.Marshal(map[string]string{"url": "https://example.com/test.png"})
	req := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID+"/images", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create test image: %d", w.Code)
	}

	var img imageResponse
	_ = json.NewDecoder(w.Body).Decode(&img)

	tests := []struct {
		name       string
		x          *float64
		y          *float64
		wantStatus int
	}{
		{
			name:       "valid position",
			x:          floatPtr(100.5),
			y:          floatPtr(200.7),
			wantStatus: http.StatusOK,
		},
		{
			name:       "reject NaN x",
			x:          floatPtr(math.NaN()),
			y:          floatPtr(100),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject NaN y",
			x:          floatPtr(100),
			y:          floatPtr(math.NaN()),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject Infinity x",
			x:          floatPtr(math.Inf(1)),
			y:          floatPtr(100),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "reject Infinity y",
			x:          floatPtr(100),
			y:          floatPtr(math.Inf(-1)),
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			updateBody, _ := json.Marshal(map[string]*float64{"x": tt.x, "y": tt.y})
			updateReq := httptest.NewRequest(http.MethodPatch, "/rooms/"+room.ID+"/images/"+img.ID, bytes.NewReader(updateBody))
			updateReq.Header.Set("Content-Type", "application/json")
			updateW := httptest.NewRecorder()
			router.ServeHTTP(updateW, updateReq)

			if updateW.Code != tt.wantStatus {
				t.Errorf("got status %d, want %d", updateW.Code, tt.wantStatus)
			}
		})
	}
}

func TestDiceLogValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()
	room := createRoomForTest(t, router)

	tests := []struct {
		name       string
		payload    map[string]any
		wantStatus int
	}{
		{
			name: "valid dice log",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       5,
				"results":     []int{1, 2, 3, 4, 5},
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusOK,
		},
		{
			name: "reject zero count",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       0,
				"results":     []int{1, 2, 3},
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "reject negative count",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       -1,
				"results":     []int{1, 2, 3},
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "reject empty results",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       5,
				"results":     []int{},
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "reject count too large",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       10000,
				"results":     make([]int, 10000),
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusBadRequest,
		},
		{
			name: "reject results array too large",
			payload: map[string]any{
				"seed":        uint32(12345),
				"count":       5,
				"results":     make([]int, 10000),
				"triggeredBy": "Player",
			},
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(tt.payload)
			req := httptest.NewRequest(http.MethodPost, "/rooms/"+room.ID+"/dice", bytes.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("got status %d, want %d", w.Code, tt.wantStatus)
			}
		})
	}
}

func TestRoomNameValidation(t *testing.T) {
	srv := newTestServer(t, t.TempDir())
	router := srv.Router()

	tests := []struct {
		name       string
		roomName   string
		wantStatus int
	}{
		{
			name:       "valid room name",
			roomName:   "My Game Room",
			wantStatus: http.StatusCreated,
		},
		{
			name:       "empty room name defaults to Untitled",
			roomName:   "",
			wantStatus: http.StatusCreated,
		},
		{
			name:       "room name at limit",
			roomName:   string(make([]byte, 100)),
			wantStatus: http.StatusCreated,
		},
		{
			name:       "reject room name too long",
			roomName:   string(make([]byte, 101)),
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := json.Marshal(map[string]string{"name": tt.roomName, "createdBy": "Creator"})
			req := httptest.NewRequest(http.MethodPost, "/rooms", bytes.NewReader(body))
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)

			if w.Code != tt.wantStatus {
				t.Errorf("got status %d, want %d for room name length %d", w.Code, tt.wantStatus, len(tt.roomName))
			}
		})
	}
}

func floatPtr(f float64) *float64 {
	return &f
}

func TestIsValidImageURL(t *testing.T) {
	tests := []struct {
		url  string
		want bool
	}{
		{"https://example.com/image.png", true},
		{"http://example.com/image.jpg", true},
		{"", false},
		{"javascript:alert('xss')", false},
		{"file:///etc/passwd", false},
		{"data:text/html,test", false},
		{"ftp://example.com/file.txt", false},
		{"//example.com/image.png", false},
		{"not-a-url", false},
	}

	for _, tt := range tests {
		t.Run(tt.url, func(t *testing.T) {
			if got := isValidImageURL(tt.url); got != tt.want {
				t.Errorf("isValidImageURL(%q) = %v, want %v", tt.url, got, tt.want)
			}
		})
	}
}

func TestIsValidPosition(t *testing.T) {
	tests := []struct {
		name string
		x    float64
		y    float64
		want bool
	}{
		{"valid", 100, 200, true},
		{"zero", 0, 0, true},
		{"negative", -100, -200, true},
		{"NaN x", math.NaN(), 100, false},
		{"NaN y", 100, math.NaN(), false},
		{"Inf x", math.Inf(1), 100, false},
		{"Inf y", 100, math.Inf(-1), false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isValidPosition(tt.x, tt.y); got != tt.want {
				t.Errorf("isValidPosition(%v, %v) = %v, want %v", tt.x, tt.y, got, tt.want)
			}
		})
	}
}

func TestIsAllowedImageType(t *testing.T) {
	tests := []struct {
		mimeType string
		want     bool
	}{
		{"image/jpeg", true},
		{"image/jpg", true},
		{"image/png", true},
		{"image/gif", true},
		{"image/webp", true},
		{"image/svg+xml", true},
		{"image/bmp", true},
		{"image/tiff", true},
		{"application/pdf", false},
		{"text/html", false},
		{"application/octet-stream", false},
		{"video/mp4", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.mimeType, func(t *testing.T) {
			if got := isAllowedImageType(tt.mimeType); got != tt.want {
				t.Errorf("isAllowedImageType(%q) = %v, want %v", tt.mimeType, got, tt.want)
			}
		})
	}
}
