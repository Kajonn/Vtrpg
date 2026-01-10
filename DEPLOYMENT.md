# Google Cloud Deployment Guide for Vtrpg

This guide provides detailed instructions for deploying Vtrpg to Google Cloud Platform using Cloud Build and Cloud Run.

## Table of Contents
1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Deployment Options](#deployment-options)
4. [Configuration](#configuration)
5. [Troubleshooting](#troubleshooting)

## Prerequisites

Before deploying, ensure you have:

1. **Google Cloud Account**: Sign up at [cloud.google.com](https://cloud.google.com/)
2. **Google Cloud Project**: Create a new project or use an existing one
3. **gcloud CLI**: Install from [cloud.google.com/sdk](https://cloud.google.com/sdk/docs/install)
4. **Billing Account**: Link your project to a billing account (required for Cloud Build and Cloud Run)

## Initial Setup

### 1. Install and Configure gcloud CLI

```bash
# Install gcloud CLI (if not already installed)
# Follow instructions at: https://cloud.google.com/sdk/docs/install

# Initialize and authenticate
gcloud init

# Set your project
gcloud config set project YOUR_PROJECT_ID
```

### 2. Enable Required APIs

```bash
# Enable Cloud Build API
gcloud services enable cloudbuild.googleapis.com

# Enable Artifact Registry API (for storing Docker images)
gcloud services enable artifactregistry.googleapis.com

# Enable Cloud Run API (for serverless deployment)
gcloud services enable run.googleapis.com
```

### 3. Create Artifact Registry Repository

```bash
# Create a Docker repository in Artifact Registry
gcloud artifacts repositories create vtrpg-repo \
  --repository-format=docker \
  --location=us-central1 \
  --description="Vtrpg Docker images"
```

### 4. Configure Docker Authentication

```bash
# Configure Docker to use gcloud as a credential helper
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## Deployment Options

### Option 1: Using the Deploy Script (Recommended for Beginners)

The easiest way to deploy is using the included `deploy.sh` script:

```bash
# Make the script executable (if not already)
chmod +x deploy.sh

# Run the deployment script
./deploy.sh YOUR_PROJECT_ID us-central1

# Follow the interactive prompts
```

The script will:
- Check if required APIs are enabled
- Create the Artifact Registry repository if needed
- Build and push the Docker image
- Optionally deploy to Cloud Run

### Option 2: Manual Build and Push

For more control, you can manually build and push the image:

```bash
# Submit the build to Cloud Build
gcloud builds submit --config=cloudbuild.yaml \
  --substitutions=_REGION=us-central1,_REPOSITORY=vtrpg-repo

# Deploy to Cloud Run (after the build completes)
gcloud run deploy vtrpg \
  --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/vtrpg-repo/vtrpg:latest \
  --region=us-central1 \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --set-env-vars="ALLOWED_ORIGINS=*,MAX_UPLOAD_SIZE=10485760,FRONTEND_DIR=/app/dist,UPLOAD_DIR=/data/uploads" \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10
```

### Option 3: Automatic Build and Deploy

Use `cloudbuild.deploy.yaml` for a single command that builds and deploys:

```bash
# First, grant Cloud Build permission to deploy to Cloud Run
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role=roles/run.admin

gcloud iam service-accounts add-iam-policy-binding \
  YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member=serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role=roles/iam.serviceAccountUser

# Then submit the build
gcloud builds submit --config=cloudbuild.deploy.yaml
```

### Option 4: Automatic Builds from GitHub

Set up automatic deployments triggered by GitHub commits:

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers)
2. Click "Connect Repository"
3. Authenticate with GitHub and select the Vtrpg repository
4. Create a new trigger:
   - **Name**: `deploy-vtrpg-main`
   - **Event**: Push to a branch
   - **Branch**: `^main$` (or your preferred branch)
   - **Configuration**: Cloud Build configuration file
   - **Location**: `/cloudbuild.deploy.yaml`
   - **Advanced** → Substitution variables:
     - `_ALLOWED_ORIGINS`: Your production domain (e.g., `https://yourdomain.com`)
5. Save the trigger

Now every push to main will automatically build and deploy!

## Configuration

### Environment Variables

Configure these for your deployment:

| Variable | Description | Default | Production Recommendation |
|----------|-------------|---------|---------------------------|
| `PORT` | HTTP server port | `8080` | `8080` (required for Cloud Run) |
| `ALLOWED_ORIGINS` | CORS allowed origins | `*` | Your domain (e.g., `https://yourdomain.com`) |
| `MAX_UPLOAD_SIZE` | Max upload size in bytes | `10485760` (10MB) | Adjust based on needs |
| `FRONTEND_DIR` | Frontend assets directory | `/app/dist` | `/app/dist` (from Docker) |
| `UPLOAD_DIR` | Upload storage directory | `/data/uploads` | See note on persistence below |

### Update Environment Variables

```bash
# Update a deployed Cloud Run service
gcloud run services update vtrpg \
  --region=us-central1 \
  --update-env-vars="ALLOWED_ORIGINS=https://yourdomain.com"
```

### Important Notes on Cloud Run

**Stateless Nature**: Cloud Run is stateless, meaning uploaded files stored in the container's filesystem will be lost when:
- The container is restarted
- The service scales down to zero
- A new revision is deployed

**Solutions for Persistent Storage**:

1. **Google Cloud Storage** (Recommended):
   - Modify the upload handler to use Cloud Storage SDK
   - Store files in a GCS bucket
   - Serve files via signed URLs or Cloud CDN

2. **Cloud Run with Persistent Volumes**:
   - Mount a Cloud Storage FUSE volume
   - Configure in your Cloud Run service

3. **Alternative Compute Options**:
   - **Google Kubernetes Engine (GKE)**: Full Kubernetes with persistent volumes
   - **Compute Engine**: Traditional VM with persistent disks

### Resource Configuration

Adjust Cloud Run resources based on your needs:

```bash
# For higher traffic or larger files
gcloud run deploy vtrpg \
  --image=us-central1-docker.pkg.dev/YOUR_PROJECT_ID/vtrpg-repo/vtrpg:latest \
  --memory=1Gi \
  --cpu=2 \
  --min-instances=1 \
  --max-instances=100 \
  --region=us-central1
```

## Troubleshooting

### Build Failures

**Problem**: Build times out or fails
```bash
# Solution: Increase timeout in cloudbuild.yaml
timeout: '1800s'  # 30 minutes
```

**Problem**: Permission denied when pushing to Artifact Registry
```bash
# Solution: Authenticate Docker
gcloud auth configure-docker us-central1-docker.pkg.dev
```

### Deployment Failures

**Problem**: Cloud Build can't deploy to Cloud Run
```bash
# Solution: Grant necessary IAM permissions
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member=serviceAccount:YOUR_PROJECT_NUMBER@cloudbuild.gserviceaccount.com \
  --role=roles/run.admin
```

**Problem**: Cloud Run service fails to start
```bash
# Solution: Check logs
gcloud run services logs read vtrpg --region=us-central1 --limit=50

# Common issues:
# - PORT must be 8080 for Cloud Run
# - Check environment variables are set correctly
```

### Application Issues

**Problem**: WebSocket connections fail
```bash
# Cloud Run supports WebSockets - ensure:
# 1. Client connects to wss:// (not ws://)
# 2. ALLOWED_ORIGINS includes the correct domain
```

**Problem**: Uploaded files disappear
```bash
# This is expected on Cloud Run - files stored in container filesystem are ephemeral
# Solution: Implement Cloud Storage integration for persistent uploads
```

### Cost Optimization

**Monitor costs**:
```bash
# View Cloud Build usage
gcloud builds list --limit=50

# View Cloud Run metrics
gcloud run services describe vtrpg --region=us-central1
```

**Cost-saving tips**:
- Use `--min-instances=0` to scale to zero (adds cold start latency)
- Set appropriate `--max-instances` to prevent unexpected scaling costs
- Use smaller memory/CPU allocations if possible
- Consider using Container Registry instead of Artifact Registry if on free tier

## Additional Resources

- [Cloud Build Documentation](https://cloud.google.com/build/docs)
- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Artifact Registry Documentation](https://cloud.google.com/artifact-registry/docs)
- [Cloud Run Pricing](https://cloud.google.com/run/pricing)
- [Cloud Build Pricing](https://cloud.google.com/build/pricing)

## Getting Help

If you encounter issues:

1. Check the [Cloud Build logs](https://console.cloud.google.com/cloud-build/builds)
2. Check the [Cloud Run logs](https://console.cloud.google.com/run)
3. Review this troubleshooting guide
4. Check the [Vtrpg repository issues](https://github.com/Kajonn/Vtrpg/issues)
