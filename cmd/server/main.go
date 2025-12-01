package main

import (
	"flag"
	"log"
	"net/http"

	"vtrpg/internal/server"
)

func main() {
	addr := flag.String("addr", ":8080", "listen address")
	uploadDir := flag.String("uploads", "uploads", "upload directory")
	flag.Parse()

	app, err := server.NewApp(*uploadDir)
	if err != nil {
		log.Fatalf("failed to init app: %v", err)
	}

	log.Printf("listening on %s", *addr)
	if err := http.ListenAndServe(*addr, app.Router()); err != nil {
		log.Fatalf("server exited: %v", err)
	}
}
