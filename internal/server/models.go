package server

import "time"

// Role represents a user's role.
type Role string

const (
	RoleGM     Role = "gm"
	RolePlayer Role = "player"
)

// User represents an authenticated session.
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Role  Role   `json:"role"`
	Token string `json:"token"`
}

// Room represents a shared space.
type Room struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	CreatedBy string    `json:"createdBy"`
	CreatedAt time.Time `json:"createdAt"`
}

// Position captures placement data for an image.
type Position struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Scale float64 `json:"scale"`
}

// SharedImage represents an image shared in a room.
type SharedImage struct {
	ID          string    `json:"id"`
	RoomID      string    `json:"roomId"`
	SourceType  string    `json:"sourceType"`
	StorageURL  string    `json:"storageUrl"`
	StoragePath string    `json:"storagePath"`
	CreatedBy   string    `json:"createdBy"`
	CreatedAt   time.Time `json:"createdAt"`
	Position    Position  `json:"position"`
}

// DiceRollPayload represents a dice roll synchronization message.
type DiceRollPayload struct {
	Seed        uint32 `json:"seed"`
	Count       int    `json:"count"`
	TriggeredBy string `json:"triggeredBy"`
}
