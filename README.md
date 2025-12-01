# VtRPG Image Sharing Server

A lightweight Go server for managing virtual tabletop rooms and sharing battlemap images with real-time streaming to connected players.

## Getting Started

### Prerequisites
- Go 1.20+

### Run the server
```bash
go run ./cmd/server -addr :8080 -uploads uploads
```
Uploads are written to the `uploads/` directory (created automatically). Static files are served from `/uploads/{filename}` with caching headers.

## Authentication
- Obtain a token by calling `POST /login` with a JSON body containing `name` and `role` (`gm` or `player`).
- Include the token on subsequent requests via `Authorization: Bearer <token>`.
- Game masters (`gm`) can create rooms; both roles can join rooms, upload/list images, and subscribe to streams.

### Example
```bash
curl -X POST http://localhost:8080/login \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice","role":"gm"}'
```
Response contains `token` for later requests.

## API

### POST /rooms (gm only)
Create a room.

Request body:
```json
{ "name": "Session 1" }
```
Response: `201 Created` with room object `{id,name,createdBy,createdAt}`.

### POST /rooms/{id}/images
Upload an image file or register an existing URL for a room. Max size 10 MB. Allowed MIME types: PNG, JPEG, WebP.

**Multipart upload**
- Content-Type: `multipart/form-data`
- Field: `file`

**JSON URL upload**
```json
{ "url": "https://example.com/map.png", "position": {"x":0,"y":0,"scale":1} }
```

Response: `201 Created` with `SharedImage` metadata:
```json
{
  "id": "...",
  "roomId": "...",
  "sourceType": "file" | "url",
  "storageUrl": "/uploads/{filename}" | "https://...",
  "createdBy": "<userId>",
  "createdAt": "<RFC3339>",
  "position": {"x":0,"y":0,"scale":1}
}
```

### GET /rooms/{id}/images
List the latest images for a room (up to 50, newest last).

Response: `200 OK` with an array of `SharedImage` entries.

### SSE stream: /ws/rooms/{id}
Server-Sent Events endpoint that pushes newly shared images in the room.

- Requires `Authorization` header like other endpoints.
- Event payloads are JSON-encoded `SharedImage` objects sent as `data: { ... }` lines.
- Includes keepalive comments every 30 seconds.

Example subscription:
```bash
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:8080/ws/rooms/<roomId>
```

## Data Model
- `User`: `{id, name, role, token}`
- `Room`: `{id, name, createdBy, createdAt}`
- `SharedImage`: `{id, roomId, sourceType, storageUrl, storagePath?, createdBy, createdAt, position}`
- `Position`: `{x, y, scale}`

## Security & Validation
- Token auth with role-based access for room creation.
- File uploads limited to 10 MB with MIME sniffing and extension validation (PNG/JPEG/WebP only).
- Unique filenames generated for stored uploads; static files served without directory listings and with cache-control headers.
