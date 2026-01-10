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

## Deployment to Google Cloud

This project includes Cloud Build configuration for easy deployment to Google Cloud Platform.

### Prerequisites

1. **Google Cloud Project**: Create a project in [Google Cloud Console](https://console.cloud.google.com/)
2. **gcloud CLI**: Install and authenticate the [gcloud CLI](https://cloud.google.com/sdk/docs/install)
3. **Enable APIs**: Enable the following APIs in your project:
   ```bash
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable artifactregistry.googleapis.com
   gcloud services enable run.googleapis.com  # If deploying to Cloud Run
   ```
4. **Artifact Registry**: Create a Docker repository:
   ```bash
   gcloud artifacts repositories create vtrpg-repo \
     --repository-format=docker \
     --location=us-central1 \
     --description="Vtrpg Docker images"
   ```

### Manual Deployment

Build and push the Docker image using Cloud Build:

```bash
# Set your project ID
export PROJECT_ID=your-project-id

# Submit the build
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_REPOSITORY=vtrpg-repo
```

The build will:
1. Build the frontend assets using Node.js
2. Compile the Go backend
3. Create a Docker image
4. Push the image to Artifact Registry with both `:latest` and `:$COMMIT_SHA` tags

### Deploying to Cloud Run (Optional)

After building the image, deploy it to Cloud Run for a fully managed, serverless deployment.

**Prerequisites**: Create a Cloud Storage bucket for persistent uploads:
```bash
gcloud storage buckets create gs://vttrpg_storage --location=us-central1
```

Deploy the service with the mounted storage bucket:

```bash
gcloud run deploy vtrpg \
  --image=us-central1-docker.pkg.dev/${PROJECT_ID}/vtrpg-repo/vtrpg:latest \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --set-env-vars="ALLOWED_ORIGINS=*,MAX_UPLOAD_SIZE=10485760,FRONTEND_DIR=/app/dist,UPLOAD_DIR=/data/uploads" \
  --add-volume=name=uploads,type=cloud-storage,bucket=vttrpg_storage \
  --add-volume-mount=volume=uploads,mount-path=/data/uploads \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10
```

**Storage Configuration**: The service mounts the Cloud Storage bucket `vttrpg_storage` at `/data/uploads` for persistent file storage. Uploaded files are preserved across container restarts and deployments.

### Automatic Builds with GitHub

Set up automatic builds triggered by GitHub commits:

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers) in GCP Console
2. Click "Connect Repository" and follow the steps to connect your GitHub repository
3. Create a new trigger:
   - **Event**: Push to a branch
   - **Branch**: `^main$` (or your preferred branch)
   - **Configuration**: Cloud Build configuration file
   - **Location**: `/cloudbuild.yaml`
4. Save the trigger

Now every push to the main branch will automatically build and push a new Docker image.

### Environment Variables for Production

For production deployments, configure these environment variables appropriately:

- `ALLOWED_ORIGINS`: Set to your actual domain(s), e.g., `https://yourdomain.com`
- `MAX_UPLOAD_SIZE`: Adjust based on your needs (default: 10MB)
- `UPLOAD_DIR`: Ensure this points to persistent storage in production

### Cost Optimization

- Cloud Build offers a free tier (120 build-minutes per day)
- Cloud Run offers a generous free tier (2 million requests/month)
- Consider using `--min-instances=0` for Cloud Run to scale to zero when not in use
- Use `--memory=512Mi` or less to reduce costs (increase only if needed)

## Frontend features

- Only one game master (GM) can connect to a room at a time; additional GM attempts are blocked until the active GM disconnects.
- Rooms broadcast active participant rosters, shown in a horizontal panel at the bottom of the room view.
- User and room selections persist across browser refreshes so sessions seamlessly continue after reloads.
- A logout button in the room header clears session data and safely disconnects the user.
- All players can pan the shared canvas to explore the scene collaboratively.
- An admin dashboard at `/admin` lists all rooms with active users, GM presence, recent activity, total active time, disk usage from uploads, and provides a delete action with confirmation.

## Room URLs and joining

- Creating a room (`POST /rooms`) returns both the room ID and a unique `slug` you can share as a permalink.
- Room metadata can be fetched by slug via `GET /rooms/slug/{slug}`; a 404 is returned when the slug is unknown.
- Players join through `POST /rooms/join` with a JSON body like `{"slug":"<room-slug>","name":"Player Name"}`. Names must be 2–32 characters using letters, numbers, spaces, hyphens, underscores, or apostrophes. The endpoint returns the resolved room information and the created player profile.

### Dice overlay

The room view includes a synchronized, fixed-size WebGL canvas that simulates 3D dice throws using Three.js. Players in the
same room share a deterministic seed for each roll, so every user sees the exact same trajectory and final result. A control
panel anchored beneath the overlay lets you adjust the number of dice, roll them, and view the rolling/settled status. The
simulation stays identical across browsers and devices by reusing the broadcast seed and fixed arena dimensions for every user.
