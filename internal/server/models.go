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

// Player represents a joined participant in a room.
type Player struct {
	ID        string    `json:"id"`
	RoomID    string    `json:"roomId"`
	Name      string    `json:"name"`
	Role      Role      `json:"role"`
	Token     string    `json:"token"`
	CreatedAt time.Time `json:"createdAt"`
}

// Theme represents a room's color theme.
type Theme string

const (
	ThemeDefault    Theme = "default"    // Dark blue (current)
	ThemeDracula    Theme = "dracula"    // Purple/pink
	ThemeNord       Theme = "nord"       // Cool blue-gray
	ThemeGruvbox    Theme = "gruvbox"    // Warm brown/orange
	ThemeSolarized  Theme = "solarized"  // Teal/yellow
	ThemeMonokai    Theme = "monokai"    // Green/pink on dark
	ThemeForest     Theme = "forest"     // Deep green
	ThemeSunset     Theme = "sunset"     // Orange/red warm
	ThemeOcean      Theme = "ocean"      // Deep ocean blue
	ThemeCyberpunk  Theme = "cyberpunk"  // Neon pink/cyan
	ThemeVampire    Theme = "vampire"    // Dark red/crimson
	ThemeMidnight   Theme = "midnight"   // Deep purple/indigo
	ThemeAurora     Theme = "aurora"     // Northern lights
	ThemeDesert     Theme = "desert"     // Sandy warm tones
	ThemeArctic     Theme = "arctic"     // Icy blue/white
	ThemeLavender   Theme = "lavender"   // Soft purple
	ThemeRose       Theme = "rose"       // Pink/rose gold
	ThemeEmerald    Theme = "emerald"    // Rich green/gold
	ThemeSlate      Theme = "slate"      // Gray/silver
	ThemeCoffee     Theme = "coffee"     // Brown/cream
	ThemeNeon       Theme = "neon"       // Bright neon green
	ThemePlum       Theme = "plum"       // Deep purple/magenta
	ThemeStorm      Theme = "storm"      // Thunder gray/electric
	ThemeCherry     Theme = "cherry"     // Cherry blossom pink
	ThemeGalaxy     Theme = "galaxy"     // Deep space purple
	ThemeMint       Theme = "mint"       // Fresh mint green
	ThemeRust       Theme = "rust"       // Rustic orange/brown
	ThemeSapphire   Theme = "sapphire"   // Royal blue
	ThemeCoral      Theme = "coral"      // Coral reef orange/pink
	ThemeOnyx       Theme = "onyx"       // Pure black/white
	ThemeAmber      Theme = "amber"      // Golden amber
	ThemeTwilight   Theme = "twilight"   // Dusk purple/orange
	ThemePine       Theme = "pine"       // Dark pine green
	ThemeMaroon     Theme = "maroon"     // Deep maroon/burgundy
)

// ValidThemes lists all supported themes.
var ValidThemes = []Theme{
	ThemeDefault,
	ThemeDracula,
	ThemeNord,
	ThemeGruvbox,
	ThemeSolarized,
	ThemeMonokai,
	ThemeForest,
	ThemeSunset,
	ThemeOcean,
	ThemeCyberpunk,
	ThemeVampire,
	ThemeMidnight,
	ThemeAurora,
	ThemeDesert,
	ThemeArctic,
	ThemeLavender,
	ThemeRose,
	ThemeEmerald,
	ThemeSlate,
	ThemeCoffee,
	ThemeNeon,
	ThemePlum,
	ThemeStorm,
	ThemeCherry,
	ThemeGalaxy,
	ThemeMint,
	ThemeRust,
	ThemeSapphire,
	ThemeCoral,
	ThemeOnyx,
	ThemeAmber,
	ThemeTwilight,
	ThemePine,
	ThemeMaroon,
}

// IsValidTheme checks if a theme name is supported.
func IsValidTheme(t Theme) bool {
	for _, valid := range ValidThemes {
		if t == valid {
			return true
		}
	}
	return false
}

// Room represents a shared space.
type Room struct {
	ID           string    `json:"id"`
	Slug         string    `json:"slug"`
	Name         string    `json:"name"`
	Theme        Theme     `json:"theme"`
	CreatedBy    string    `json:"createdBy"`
	CreatedBySub string    `json:"createdBySub,omitempty"` // Auth0 subject
	CreatedAt    time.Time `json:"createdAt"`
}

type RoomActivity struct {
	LastUsedAt         *time.Time `json:"lastUsedAt,omitempty"`
	TotalActiveSeconds int64      `json:"totalActiveSeconds"`
	ActiveSince        *time.Time `json:"activeSince,omitempty"`
}

type AdminRoomSummary struct {
	ID                 string          `json:"id"`
	Slug               string          `json:"slug"`
	Name               string          `json:"name"`
	CreatedBy          string          `json:"createdBy"`
	CreatedAt          time.Time       `json:"createdAt"`
	Active             bool            `json:"active"`
	ActiveSince        *time.Time      `json:"activeSince,omitempty"`
	LastUsedAt         *time.Time      `json:"lastUsedAt,omitempty"`
	TotalActiveSeconds int64           `json:"totalActiveSeconds"`
	DiskUsageBytes     int64           `json:"diskUsageBytes"`
	ActiveUsers        []clientProfile `json:"activeUsers"`
	GMConnected        bool            `json:"gmConnected"`
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
	Sides       int    `json:"sides"`
	TriggeredBy string `json:"triggeredBy"`
}
