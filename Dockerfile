# Build frontend assets
FROM node:20-alpine AS frontend
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build

# Build Go server
FROM golang:1.24-alpine AS go-builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 go build -o server ./cmd/server

# Runtime image
FROM alpine:3.19
WORKDIR /app
COPY --from=go-builder /app/server /usr/local/bin/server
COPY --from=frontend /app/dist ./dist
RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /data/uploads \
    && chown -R app:app /data/uploads

ENV PORT=8080 \
    ALLOWED_ORIGINS=* \
    MAX_UPLOAD_SIZE=10485760 \
    FRONTEND_DIR=/app/dist \
    UPLOAD_DIR=/data/uploads

VOLUME ["/data/uploads"]
EXPOSE 8080
USER app
ENTRYPOINT ["/usr/local/bin/server"]
