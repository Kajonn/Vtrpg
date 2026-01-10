# Google Cloud Quick Reference

Quick commands for deploying and managing Vtrpg on Google Cloud Platform.

## Initial Setup (One-time)

```bash
# Authenticate
gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Enable APIs
gcloud services enable cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com

# Create Artifact Registry repository
gcloud artifacts repositories create vtrpg-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Vtrpg Docker images"

# Create Cloud Storage bucket for uploads
gcloud storage buckets create gs://vttrpg_storage \
  --location=us-central1 \
  --uniform-bucket-level-access

# Configure Docker
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## Quick Deploy

```bash
# Option 1: Use the helper script (easiest)
./deploy.sh YOUR_PROJECT_ID

# Option 2: Manual build and deploy
gcloud builds submit --config=cloudbuild.yaml
gcloud run deploy vtrpg \
  --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/vtrpg-repo/vtrpg:latest \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --add-volume=name=uploads,type=cloud-storage,bucket=vttrpg_storage \
  --add-volume-mount=volume=uploads,mount-path=/data/uploads

# Option 3: Build and deploy in one command
gcloud builds submit --config=cloudbuild.deploy.yaml
```

## Common Operations

```bash
# View recent builds
gcloud builds list --limit=10

# View build logs
gcloud builds log BUILD_ID

# View Cloud Run services
gcloud run services list

# Get service URL
gcloud run services describe vtrpg \
  --region=us-central1 \
  --format="value(status.url)"

# View service logs
gcloud run services logs read vtrpg \
  --region=us-central1 \
  --limit=50

# Update environment variables
gcloud run services update vtrpg \
  --region=us-central1 \
  --update-env-vars="ALLOWED_ORIGINS=https://yourdomain.com"

# Scale service
gcloud run services update vtrpg \
  --region=us-central1 \
  --min-instances=1 \
  --max-instances=20

# Delete service
gcloud run services delete vtrpg --region=us-central1
```

## Troubleshooting

```bash
# Check build status
gcloud builds list --ongoing

# Stream build logs
gcloud builds log --stream BUILD_ID

# Check service health
gcloud run services describe vtrpg \
  --region=us-central1 \
  --format="value(status.conditions)"

# Get service details
gcloud run services describe vtrpg \
  --region=us-central1

# Test local service
curl https://YOUR-SERVICE-URL/
```

## Cost Management

```bash
# View Cloud Run metrics
gcloud run services describe vtrpg \
  --region=us-central1 \
  --format="value(status.traffic)"

# Set to scale to zero (save costs)
gcloud run services update vtrpg \
  --region=us-central1 \
  --min-instances=0

# List all services (check for unused services)
gcloud run services list --platform=managed

# Delete unused images
gcloud artifacts docker images delete \
  us-central1-docker.pkg.dev/YOUR_PROJECT_ID/vtrpg-repo/vtrpg:TAG
```

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | Server port (must be 8080 for Cloud Run) |
| `ALLOWED_ORIGINS` | `*` | CORS allowed origins (set to your domain) |
| `MAX_UPLOAD_SIZE` | `10485760` | Max upload size in bytes (10MB) |
| `FRONTEND_DIR` | `/app/dist` | Frontend assets directory |
| `UPLOAD_DIR` | `/data/uploads` | Upload storage directory |

## URLs and Resources

- GCP Console: https://console.cloud.google.com
- Cloud Build: https://console.cloud.google.com/cloud-build
- Cloud Run: https://console.cloud.google.com/run
- Artifact Registry: https://console.cloud.google.com/artifacts
- Logs Explorer: https://console.cloud.google.com/logs

## Support

For detailed instructions, see:
- `DEPLOYMENT.md` - Comprehensive deployment guide
- `README.md` - General project documentation
- Cloud Build docs: https://cloud.google.com/build/docs
- Cloud Run docs: https://cloud.google.com/run/docs
