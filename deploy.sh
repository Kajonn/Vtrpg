#!/bin/bash
# deploy.sh - Helper script for deploying Vtrpg to Google Cloud
# 
# Usage:
#   ./deploy.sh [PROJECT_ID] [REGION]
#
# Example:
#   ./deploy.sh my-gcp-project us-central1

set -e

# Default values
DEFAULT_REGION="us-central1"
DEFAULT_REPOSITORY="vtrpg-repo"
DEFAULT_SERVICE="vtrpg"

# Get project ID from argument or gcloud config
PROJECT_ID="${1:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${2:-$DEFAULT_REGION}"
REPOSITORY="${3:-$DEFAULT_REPOSITORY}"
SERVICE="${4:-$DEFAULT_SERVICE}"

if [ -z "$PROJECT_ID" ]; then
    echo "Error: PROJECT_ID is required"
    echo "Usage: $0 [PROJECT_ID] [REGION] [REPOSITORY] [SERVICE]"
    echo "Example: $0 my-gcp-project us-central1"
    exit 1
fi

echo "======================================"
echo "Deploying Vtrpg to Google Cloud"
echo "======================================"
echo "Project ID:  $PROJECT_ID"
echo "Region:      $REGION"
echo "Repository:  $REPOSITORY"
echo "Service:     $SERVICE"
echo "======================================"
echo

# Check if required APIs are enabled
echo "Checking if required APIs are enabled..."
REQUIRED_APIS=(
    "cloudbuild.googleapis.com"
    "artifactregistry.googleapis.com"
    "run.googleapis.com"
)

for api in "${REQUIRED_APIS[@]}"; do
    if gcloud services list --enabled --project="$PROJECT_ID" --filter="name:$api" --format="value(name)" | grep -q "$api"; then
        echo "✓ $api is enabled"
    else
        echo "⚠ $api is not enabled. Enabling..."
        gcloud services enable "$api" --project="$PROJECT_ID"
    fi
done

echo

# Check if Artifact Registry repository exists
echo "Checking if Artifact Registry repository exists..."
if gcloud artifacts repositories describe "$REPOSITORY" \
    --location="$REGION" \
    --project="$PROJECT_ID" &>/dev/null; then
    echo "✓ Repository $REPOSITORY already exists"
else
    echo "⚠ Repository $REPOSITORY does not exist. Creating..."
    gcloud artifacts repositories create "$REPOSITORY" \
        --repository-format=docker \
        --location="$REGION" \
        --project="$PROJECT_ID" \
        --description="Vtrpg Docker images"
fi

echo

# Build and push the Docker image
echo "Building and pushing Docker image..."
gcloud builds submit \
    --config=cloudbuild.yaml \
    --project="$PROJECT_ID" \
    --substitutions="_REGION=$REGION,_REPOSITORY=$REPOSITORY,_SERVICE_NAME=$SERVICE"

echo
echo "✓ Image built and pushed successfully"
echo

# Ask if user wants to deploy to Cloud Run
read -p "Do you want to deploy to Cloud Run? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Get the latest image
    IMAGE_NAME="$REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/vtrpg:latest"
    
    echo "Deploying to Cloud Run..."
    gcloud run deploy "$SERVICE" \
        --image="$IMAGE_NAME" \
        --region="$REGION" \
        --platform=managed \
        --allow-unauthenticated \
        --port=8080 \
        --set-env-vars="ALLOWED_ORIGINS=*,MAX_UPLOAD_SIZE=10485760,FRONTEND_DIR=/app/dist,UPLOAD_DIR=/data/uploads" \
        --add-volume=name=uploads,type=cloud-storage,bucket=vttrpg_storage \
        --add-volume-mount=volume=uploads,mount-path=/data/uploads \
        --memory=512Mi \
        --cpu=1 \
        --min-instances=0 \
        --max-instances=10 \
        --project="$PROJECT_ID"
    
    echo
    echo "✓ Deployment complete!"
    echo
    
    # Get the service URL
    SERVICE_URL=$(gcloud run services describe "$SERVICE" \
        --region="$REGION" \
        --project="$PROJECT_ID" \
        --format="value(status.url)")
    
    echo "======================================"
    echo "Service URL: $SERVICE_URL"
    echo "======================================"
    echo
    echo "⚠ IMPORTANT: Update ALLOWED_ORIGINS in Cloud Run environment variables"
    echo "   to include your actual domain for production use:"
    echo
    echo "   gcloud run services update $SERVICE \\"
    echo "     --region=$REGION \\"
    echo "     --update-env-vars=ALLOWED_ORIGINS=$SERVICE_URL \\"
    echo "     --project=$PROJECT_ID"
    echo
else
    echo "Skipping Cloud Run deployment."
    echo "Your image is available at: $REGION-docker.pkg.dev/$PROJECT_ID/$REPOSITORY/vtrpg:latest"
fi

echo
echo "Done!"
