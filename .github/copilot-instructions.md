Project overview

- This repo is a minimal Go backend that serves a static React SPA and provides a small image-sharing WebSocket/REST API used by the frontend.
- Backend entry: [cmd/server/main.go](cmd/server/main.go). Core server logic: [internal/server/server.go](internal/server/server.go).
- The frontend SPA lives in the repo `src/` (React + Vite). See [src/App.jsx](src/App.jsx) and components in [src/components](src/components). Room routing uses React Router v7.

Key architecture and data flow

- Static assets: the Go server serves files under the configured `FRONTEND_DIR` (default `dist`). The SPA talks to the server on the same host.
- REST endpoints and behavior (examples in `internal/server/server.go`):
  - `GET /rooms/{roomId}/images` — list images for a room.
  - `POST /rooms/{roomId}/images` — upload images (multipart `file` form field) or share by URL (JSON `{ "url": "..." }`).
  - `PATCH /rooms/{roomId}/images/{imageId}` — move image (JSON `{x, y}`).
  - `DELETE /rooms/{roomId}/images/{imageId}` — remove image and delete stored file when applicable.
  - `GET /ws/rooms/{roomId}` — WebSocket/stream endpoint used by the SPA for realtime updates.
  - Room slugs: `POST /rooms` returns `slug` alongside `id`; `GET /rooms/slug/{slug}` resolves metadata; players join with `POST /rooms/join` using `{ "slug": "<slug>", "name": "<display name>" }` (name 2–32 chars, limited charset).

Notable implementation details for AI agents

- WebSocket implementation: the server implements low-level WebSocket frame handling in [internal/server/websocket.go](internal/server/websocket.go) (no external WS library). Use the same plain `WebSocket` browser API used in [src/App.jsx](src/App.jsx) when writing tests or helpers.
- File uploads: server expects multipart form files under the `file` key. The single-file response is the created image object; multiple files return an array. See file handling in `handleImageCreate` and `handleUpload`.
- CORS is handled in [internal/server/cors.go](internal/server/cors.go). Allowed origins come from `ALLOWED_ORIGINS` env.
- Config via env: `PORT`, `MAX_UPLOAD_SIZE`, `ALLOWED_ORIGINS`, `FRONTEND_DIR`, `UPLOAD_DIR` — see [internal/server/config.go](internal/server/config.go).
- Logging uses Go `slog` JSON handler to stdout (structured logs). Avoid changing log format without updating tooling that parses stdout (CI/docker logs).

Dev workflows & important commands

- Build backend: `go build ./cmd/server` or run: `PORT=8080 go run ./cmd/server`.
- Build frontend (root Vite app): `npm run build` (root `package.json` runs `vite build`). The frontend `dist` should be placed at `FRONTEND_DIR` (default `dist`) before starting the Go server.
- Frontend build helper: `frontend` folder has a `scripts/build.js` invoked by `frontend/package.json` if used.
- Tests: Go unit tests with `go test ./...`; frontend lint via `npm run lint`; e2e tests (Playwright) via `npm run test:e2e` (see [playwright.config.js](playwright.config.js)). Run e2e when making substantial feature or flow changes; skip for docs-only edits.
- Docker: build with `docker build -t vtrpg .` and run with `docker compose up --build` (Dockerfile and `docker-compose.yml` present).

Project conventions & patterns

- **Backend style**:
  - Minimal dependencies: prefer stdlib. Look at raw net.Conn handling in `websocket.go` and expect simple, synchronous handlers in `server.go`.
  - Use `slog` for structured logging with context fields: `slog.Info("message", "field", value)`.
  - HTTP handlers follow pattern: validate input → perform action → log result → return JSON or status.
  - Error responses use `http.Error()` or JSON with `{"error": "message"}` format.
- **Frontend style**:
  - Use functional components with hooks (useState, useEffect, useContext).
  - PropTypes validation for all component props.
  - Event handlers prefixed with `handle*` (e.g., `handleUpload`, `handleMove`).
  - Keep components focused and single-purpose; extract reusable logic into custom hooks.
- **State management**:
  - In-memory state for rooms/images: the server stores images in memory (`s.images`) and persists uploaded files to `UPLOAD_DIR`. Tests exercise lifecycle behaviour in [internal/server/server_test.go](internal/server/server_test.go).
  - Frontend uses React Context for global state (user session, room data). Local state via useState for component-specific UI.
- **Role-based behavior**:
  - Frontend treats `role === 'gm'` as the privileged editor; the UI guards upload/move/delete operations — mirror that in tests.
  - Backend validates room ownership for privileged operations (future: enforce in handlers, not just UI).

Examples you can use directly

**REST API calls:**
- Upload a file to room `alpha`:
  ```bash
  curl -v -F "file=@./image.png" http://localhost:8080/rooms/alpha/images
  ```
- Share by URL:
  ```bash
  curl -v -X POST -H "Content-Type: application/json" \
    -d '{"url":"https://example.com/image.jpg"}' \
    http://localhost:8080/rooms/alpha/images
  ```
- Move an image:
  ```bash
  curl -v -X PATCH -H "Content-Type: application/json" \
    -d '{"x":10,"y":20}' \
    http://localhost:8080/rooms/alpha/images/<imageId>
  ```
- Create a room:
  ```bash
  curl -X POST http://localhost:8080/rooms
  # Response: {"id":"<roomId>","slug":"<unique-slug>"}
  ```
- Join a room:
  ```bash
  curl -X POST -H "Content-Type: application/json" \
    -d '{"slug":"example-slug","name":"Player One"}' \
    http://localhost:8080/rooms/join
  ```

**WebSocket connection (JavaScript):**
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/rooms/alpha');
ws.onopen = () => console.log('Connected');
ws.onmessage = (event) => console.log('Message:', JSON.parse(event.data));
ws.send(JSON.stringify({ type: 'ping' }));
```

**Common Go patterns in this codebase:**
```go
// Structured logging
slog.Info("image uploaded", "roomId", roomId, "imageId", imageId)

// Error handling in handlers
if err != nil {
    slog.Error("failed to process", "error", err)
    http.Error(w, "Internal server error", http.StatusInternalServerError)
    return
}

// JSON response
w.Header().Set("Content-Type", "application/json")
json.NewEncoder(w).Encode(responseData)
```

**React component patterns:**
```javascript
// Functional component with PropTypes
function ImageCard({ image, onMove, onDelete }) {
  const handleClick = () => onMove(image.id);
  return <div onClick={handleClick}>...</div>;
}
ImageCard.propTypes = {
  image: PropTypes.object.isRequired,
  onMove: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
};
```

What to avoid changing without review

- Altering the low-level WebSocket frame handling or switching to a different framing library without confirming compatibility with the existing browser client.
- Changing log output format (structured JSON) which is expected by local CI and Docker logs.
- Modifying the room slug generation or validation logic without ensuring backward compatibility.
- Changing the player name validation rules (2-32 chars, limited charset) as this affects existing clients.

Testing guidance

- **Unit tests**: Run `go test ./...` for backend changes. Tests are in `*_test.go` files alongside source code.
- **Frontend linting**: Run `npm run lint` to check React/JSX code style. Fix issues before committing.
- **E2E tests**: Run `npm run test:e2e` for feature changes affecting user flows. Tests are in `tests/` directory using Playwright.
- **Manual testing**: For WebSocket changes, test with multiple concurrent clients. For upload changes, test with various file sizes and types.
- **Test data**: Use test images/files from `tests/fixtures/` if available, or create temporary test files in `/tmp`.

Error handling patterns

- Backend errors should use appropriate HTTP status codes (400 for client errors, 500 for server errors).
- WebSocket errors should close the connection gracefully and log the error with structured `slog` fields.
- File upload errors should clean up partial uploads and return descriptive error messages.
- Frontend errors should be caught and displayed to users via the UI, not just logged to console.

Security considerations

- **File uploads**: Always validate file types and sizes. The server enforces `MAX_UPLOAD_SIZE`. Do not bypass this check.
- **WebSocket origin**: CORS validation happens in `cors.go`. Respect the `ALLOWED_ORIGINS` configuration.
- **Input validation**: Room names, player names, and all user inputs must be validated and sanitized.
- **Path traversal**: When handling file paths or room IDs, validate against path traversal attacks.
- **XSS prevention**: When displaying user-generated content (player names, room names), ensure proper escaping in React components.

Dependency management

- **Go modules**: Add dependencies with `go get`. Run `go mod tidy` after adding/removing packages.
- **NPM packages**: Add dependencies with `npm install --save` (runtime) or `npm install --save-dev` (dev only).
- **Minimal dependencies**: Prefer stdlib for Go. For frontend, use well-maintained packages with good security track records.
- **Version pinning**: Lock versions in `go.mod` and `package-lock.json`. Update deliberately, not automatically.

Troubleshooting tips

- **WebSocket connection fails**: Check CORS settings (`ALLOWED_ORIGINS`). Verify the WebSocket URL matches the server origin.
- **File upload fails**: Check `MAX_UPLOAD_SIZE` and `UPLOAD_DIR` permissions. Ensure multipart form uses the `file` field name.
- **Frontend not loading**: Verify `FRONTEND_DIR` points to `dist` and `npm run build` completed successfully.
- **Port conflicts**: If port 8080 is busy, set `PORT=8081` or another available port.
- **Build errors**: Run `go mod download` and `npm install` to ensure all dependencies are installed.

If anything here is unclear or you want more detail (e.g., message shapes on the WebSocket, sample payloads, or CI commands), tell me which area to expand.
