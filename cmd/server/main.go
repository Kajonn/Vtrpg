package main

import (
<<<<<<< ours
	"flag"
	"log"
	"net/http"
=======
	"log"
>>>>>>> theirs

	"vtrpg/internal/server"
)

func main() {
<<<<<<< ours
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
=======
	cfg := server.LoadConfig()
	srv, err := server.New(cfg)
	if err != nil {
		log.Fatalf("failed to initialize server: %v", err)
	}

	if err := srv.Run(); err != nil {
		log.Fatalf("server error: %v", err)
>>>>>>> theirs
	}
}
