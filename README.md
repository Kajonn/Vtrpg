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

Playwright browsers can be provided three ways without touching system packages:

- **Project-local install**: download Chromium into a repo-scoped cache and run the suite locally.

  ```bash
  npm run playwright:install
  npm run test:e2e
  ```

- **Offline/manual cache**: stage a browser directory from another machine when CDN downloads are blocked.

  ```bash
  # On a machine with internet:
  PLAYWRIGHT_BROWSERS_PATH=./playwright-cache npx playwright install chromium

  # Copy the generated playwright-cache directory into this repo, then:
  npm run playwright:install:offline
  npm run test:e2e
  ```

  The offline script copies any `chromium-<revision>` folders found under `./playwright-cache` into the `.cache/ms-playwright`
  directory that Playwright expects. If required folders are missing, it prints which ones to provide.

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
