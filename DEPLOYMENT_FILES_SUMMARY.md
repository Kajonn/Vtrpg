# Deployment Files Summary

This document provides an overview of all the files added for Google Cloud deployment.

## Files Added

### 1. `cloudbuild.yaml`
**Purpose**: Main Cloud Build configuration for building and pushing Docker images.

**What it does**:
- Builds the Docker image (frontend + backend)
- Pushes image to Google Artifact Registry with commit SHA and latest tags
- Includes optional commented-out Cloud Run deployment step

**Usage**: 
```bash
gcloud builds submit --config=cloudbuild.yaml
```

### 2. `cloudbuild.deploy.yaml`
**Purpose**: Cloud Build configuration with automatic Cloud Run deployment.

**What it does**:
- Everything `cloudbuild.yaml` does
- Automatically deploys to Cloud Run after building

**Usage**:
```bash
gcloud builds submit --config=cloudbuild.deploy.yaml
```

**Note**: Requires additional IAM permissions for Cloud Build service account.

### 3. `.gcloudignore`
**Purpose**: Specifies files to exclude when uploading build context to Cloud Build.

**What it excludes**:
- Development files (.vscode, .codex)
- Build artifacts (node_modules, dist, compiled binaries)
- Test outputs
- Git files
- Temporary files
- User uploads

**Impact**: Reduces build context size and speeds up uploads.

### 4. `deploy.sh`
**Purpose**: Interactive helper script for easy deployment.

**What it does**:
- Checks if required APIs are enabled
- Creates Artifact Registry repository if needed
- Submits build to Cloud Build
- Optionally deploys to Cloud Run with user confirmation
- Displays service URL after deployment

**Usage**:
```bash
./deploy.sh YOUR_PROJECT_ID us-central1
```

### 5. `DEPLOYMENT.md`
**Purpose**: Comprehensive deployment guide with step-by-step instructions.

**Contents**:
- Prerequisites and initial setup
- Four deployment options (script, manual, auto-deploy, GitHub triggers)
- Configuration details
- CI/CD with GitHub Actions setup
- Troubleshooting guide
- Resource links

**Audience**: Developers deploying for the first time.

### 6. `CLOUD_QUICK_REFERENCE.md`
**Purpose**: Quick reference card for common commands.

**Contents**:
- Initial setup commands
- Quick deploy commands
- Common operations (logs, updates, scaling)
- Troubleshooting commands
- Environment variable reference
- Cost management tips

**Audience**: Developers who have already set up and need quick command lookup.

### 7. `.github/workflows/deploy-gcloud.yml`
**Purpose**: GitHub Actions workflow for CI/CD automation.

**What it does**:
- Triggers on push to main branch or manual dispatch
- Authenticates to Google Cloud
- Builds and pushes Docker image
- Deploys to Cloud Run
- Creates deployment summary

**Requirements**:
- GitHub repository secrets configured (GCP_PROJECT_ID, GCP_SA_KEY, ALLOWED_ORIGINS)
- GCP service account with appropriate permissions

### 8. Updated `README.md`
**Purpose**: Added Google Cloud deployment section.

**New section includes**:
- Prerequisites
- Manual deployment steps
- Cloud Run deployment instructions
- GitHub automatic builds setup
- Environment variables configuration
- Cost optimization tips
- Important notes about persistent storage

## Deployment Options Summary

| Method | File | When to Use | Complexity |
|--------|------|-------------|------------|
| Helper Script | `deploy.sh` | First-time setup, quick deploys | Low |
| Manual | `cloudbuild.yaml` | Full control, custom configurations | Medium |
| Auto-deploy | `cloudbuild.deploy.yaml` | Single-command build+deploy | Medium |
| GitHub Actions | `.github/workflows/deploy-gcloud.yml` | CI/CD automation | High |
| GCP Triggers | Setup in Console with `cloudbuild.deploy.yaml` | Fully automated GitOps | Medium |

## Quick Start

For first-time deployment:
1. Read `DEPLOYMENT.md` for detailed setup instructions
2. Run `./deploy.sh YOUR_PROJECT_ID`
3. Keep `CLOUD_QUICK_REFERENCE.md` handy for future operations

For CI/CD automation:
1. Follow GitHub Actions setup in `DEPLOYMENT.md`
2. Configure repository secrets
3. Push to main branch

## Architecture Overview

```
┌─────────────────┐
│  Local Machine  │
│  or GitHub      │
└────────┬────────┘
         │
         │ gcloud builds submit
         │ or GitHub Actions
         ▼
┌─────────────────┐
│  Cloud Build    │◄─── cloudbuild.yaml or cloudbuild.deploy.yaml
│  - Build frontend
│  - Build backend │
│  - Create image  │
└────────┬────────┘
         │
         │ Push image
         ▼
┌─────────────────┐
│ Artifact        │
│ Registry        │
└────────┬────────┘
         │
         │ Deploy
         ▼
┌─────────────────┐
│  Cloud Run      │
│  - Serve app    │
│  - Auto-scale   │
└─────────────────┘
```

## Key Concepts

### Artifact Registry vs Container Registry
- **Artifact Registry** (recommended): Newer, more features, better security
- **Container Registry** (gcr.io): Legacy, still supported
- Default configuration uses Artifact Registry

### Build Tags
- `latest`: Always points to the most recent build
- `$COMMIT_SHA`: Specific commit, enables rollbacks

### Substitution Variables
Cloud Build configs use substitution variables for flexibility:
- `${PROJECT_ID}`: Your GCP project ID
- `${_REGION}`: Deployment region
- `${_REPOSITORY}`: Artifact Registry repository name
- Override with `--substitutions` flag

### IAM Permissions Required

**For Cloud Build to build and push images**:
- `roles/cloudbuild.builds.editor` (automatically granted)
- `roles/artifactregistry.writer` (automatically granted)

**For Cloud Build to deploy to Cloud Run**:
- `roles/run.admin`
- `roles/iam.serviceAccountUser`

## Cost Considerations

### Free Tier
- **Cloud Build**: 120 build-minutes/day
- **Cloud Run**: 2 million requests/month, 360,000 GB-seconds/month
- **Artifact Registry**: 0.5 GB free storage

### Typical Costs (Beyond Free Tier)
- **Build**: ~$0.003/build-minute
- **Cloud Run**: Pay only when serving requests with `--min-instances=0`
- **Storage**: ~$0.10/GB/month for images

### Cost Optimization
- Use `--min-instances=0` to scale to zero
- Delete old image versions
- Use smaller machine types if build time is acceptable
- Consider build caching for faster builds

## Security Notes

1. **Service Account Keys**: Store GitHub secret securely, rotate regularly
2. **ALLOWED_ORIGINS**: Set to your actual domain in production (not `*`)
3. **Persistent Storage**: Cloud Run is stateless; use Cloud Storage for uploads
4. **IAM**: Follow principle of least privilege for service accounts

## Next Steps After Deployment

1. Set up custom domain with Cloud Run
2. Configure Cloud CDN for static assets
3. Implement Cloud Storage for persistent file uploads
4. Set up monitoring and alerting
5. Configure Cloud Armor for DDoS protection
6. Implement database (Cloud SQL, Firestore) if needed

## Maintenance

- Monitor builds: https://console.cloud.google.com/cloud-build/builds
- Monitor service: https://console.cloud.google.com/run
- Update dependencies regularly
- Review and clean up old images
- Check logs for errors

## Support Resources

- **Cloud Build**: https://cloud.google.com/build/docs
- **Cloud Run**: https://cloud.google.com/run/docs
- **Artifact Registry**: https://cloud.google.com/artifact-registry/docs
- **GitHub Actions**: https://docs.github.com/en/actions

## Version History

- Initial implementation: Complete Google Cloud Build deployment setup
  - Cloud Build configurations
  - Deployment scripts
  - Documentation
  - GitHub Actions workflow
