package main

import (
	"log"

	"vtrpg/internal/server"
)

func main() {
	cfg := server.LoadConfig()
	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("failed to initialize server: %v", err)
	}

	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
