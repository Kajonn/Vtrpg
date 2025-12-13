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

## End-to-end tests (Playwright)

Two ways to satisfy the Playwright browser requirement without touching system packages:

- **Project-local install**: download Chromium into a repo-scoped cache and run the suite locally.

  ```bash
  npm run playwright:install
  npm run test:e2e
  ```

- **Dockerized runner**: execute the tests inside the upstream Playwright container (browsers preinstalled). This mounts the repo into the container and runs using `playwright.docker.config.js`.

  ```bash
  docker compose run --rm e2e
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
