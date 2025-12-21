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

- Minimal dependencies on backend: prefer stdlib. Look at raw net.Conn handling in `websocket.go` and expect simple, synchronous handlers in `server.go`.
- In-memory state for rooms/images: the server stores images in memory (`s.images`) and persists uploaded files to `UPLOAD_DIR`. Tests exercise lifecycle behaviour in [internal/server/server_test.go](internal/server/server_test.go).
- Frontend treats `role === 'gm'` as the privileged editor; the UI guards upload/move/delete operations — mirror that in tests.

Examples you can use directly

- Upload a file to room `alpha`:
  - `curl -v -F "file=@./image.png" http://localhost:8080/rooms/alpha/images`
- Share by URL:
  - `curl -v -X POST -H "Content-Type: application/json" -d '{"url":"https://…"}' http://localhost:8080/rooms/alpha/images`
- Move an image:
  - `curl -v -X PATCH -H "Content-Type: application/json" -d '{"x":10,"y":20}' http://localhost:8080/rooms/alpha/images/<imageId>`

What to avoid changing without review

- Altering the low-level WebSocket frame handling or switching to a different framing library without confirming compatibility with the existing browser client.
- Changing log output format (structured JSON) which is expected by local CI and Docker logs.

If anything here is unclear or you want more detail (e.g., message shapes on the WebSocket, sample payloads, or CI commands), tell me which area to expand.
