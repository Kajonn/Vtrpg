# Agent instructions for Vtrpg (applies to the entire repository)

## Repo overview
- Go backend serves the React SPA and exposes REST/WebSocket endpoints. Entry: `cmd/server/main.go`; core logic: `internal/server/server.go`.
- Frontend lives under `src/` (React + Vite, React Router v7). Shared components: `src/components/`; app entry: `src/App.jsx`.
- Static assets are served from `FRONTEND_DIR` (default `dist`). The SPA calls the API on the same origin.

## Key behaviors
- Room creation (`POST /rooms`) returns an `id` and shareable `slug`.
- Room lookup by slug: `GET /rooms/slug/{slug}` (404 if unknown).
- Players join via `POST /rooms/join` with `{ "slug": "<slug>", "name": "<display name>" }`; names must be 2–32 characters limited to letters, numbers, spaces, hyphens, underscores, or apostrophes.
- Images: `GET/POST/PATCH/DELETE /rooms/{roomId}/images`; uploads expect multipart `file`, URL shares use `{ "url": "..." }`.
- WebSockets use the custom implementation in `internal/server/websocket.go`; do not swap libraries or change framing without coordination.
- Logging uses `slog` JSON to stdout; avoid altering format.

## Development workflow
- Backend: `go build ./cmd/server` or `PORT=8080 go run ./cmd/server`.
- Frontend: `npm run dev` for Vite; production build with `npm run build` (output in `dist`).
- CORS: set `ALLOWED_ORIGINS` (e.g., `http://localhost:5173`) when using the dev server.

## Testing expectations
- Run `go test ./...` and `npm run lint` for backend/frontend changes.
- Run `npm run test:e2e` (Playwright) for substantial feature or flow updates; may be skipped for documentation-only or comment-only edits.
- Note any skipped checks in the final summary.
- When running Playwright locally, install browsers first with `npx playwright install --with-deps` (proxy restrictions may require the fallback download URLs Playwright uses automatically).
- Only use English language

## Style and safety
- Prefer stdlib on the backend; keep handlers simple and align with existing patterns.
- Keep React components idiomatic (hooks, functional components).
- Maintain existing roles: `gm` is privileged; others are players.
- Do not introduce try/catch around imports or change deployment-critical paths without mention.
