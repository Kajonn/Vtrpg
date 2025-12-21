# Vtrpg server

A minimal Go web server that serves a static single-page frontend, handles uploads, and provides a WebSocket echo endpoint with structured JSON logging.

## Configuration

Environment variables:

- `PORT` (default `8080`): Port the HTTP server listens on.
- `MAX_UPLOAD_SIZE` (bytes, default `10485760`): Maximum allowed upload size.
- `ALLOWED_ORIGINS` (comma-separated, default `*`): Origins accepted for HTTP and WebSocket requests.
- `FRONTEND_DIR` (default `dist`): Directory containing built frontend assets.
- `UPLOAD_DIR` (default `uploads`): Directory where uploaded files are stored.

## Development

Build the Go server and static frontend:

```bash
go build ./cmd/server
npm run build
```

Run the server locally:

```bash
PORT=8080 go run ./cmd/server
```

## Local development workflow

- Install dependencies with `npm install` and `go mod download`.
- For iterative frontend work, run `npm run dev` to start the Vite dev server. Set `ALLOWED_ORIGINS=http://localhost:5173` so the Go API accepts browser requests from the dev server.
- To exercise the full stack, build the frontend (`npm run build`) and start the Go server with `FRONTEND_DIR=dist PORT=8080 go run ./cmd/server`. Static assets will be served from the build output and API endpoints share the same origin.
- Lint the frontend with `npm run lint`. End-to-end tests live in `tests/e2e` and run with `npm run test:e2e` (Playwright).

## Docker

Build and run with Docker:

```bash
docker build -t vtrpg .
docker run --rm -p 8080:8080 -v $(pwd)/uploads:/data/uploads vtrpg
```

Or use docker-compose:

```bash
docker compose up --build
```

Uploads are stored in the `uploads` directory (or the mounted volume) and served under `/uploads/`.

## Frontend features

- Only one game master (GM) can connect to a room at a time; additional GM attempts are blocked until the active GM disconnects.
- Rooms broadcast active participant rosters, shown in a horizontal panel at the bottom of the room view.
- User and room selections persist across browser refreshes so sessions seamlessly continue after reloads.
- A logout button in the room header clears session data and safely disconnects the user.
- All players can pan the shared canvas to explore the scene collaboratively.

## Room URLs and joining

- Creating a room (`POST /rooms`) returns both the room ID and a unique `slug` you can share as a permalink.
- Room metadata can be fetched by slug via `GET /rooms/slug/{slug}`; a 404 is returned when the slug is unknown.
- Players join through `POST /rooms/join` with a JSON body like `{"slug":"<room-slug>","name":"Player Name"}`. Names must be 2–32 characters using letters, numbers, spaces, hyphens, underscores, or apostrophes. The endpoint returns the resolved room information and the created player profile.

### Dice overlay

The room view includes a synchronized, fixed-size WebGL canvas that simulates 3D dice throws using Three.js. Players in the
same room share a deterministic seed for each roll, so every user sees the exact same trajectory and final result. A control
panel anchored beneath the overlay lets you adjust the number of dice, roll them, and view the rolling/settled status. The
simulation stays identical across browsers and devices by reusing the broadcast seed and fixed arena dimensions for every user.
