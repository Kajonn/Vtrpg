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
