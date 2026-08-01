package main

import (
	"context"
	"encoding/json"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

func writeJSON(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	redisURL := os.Getenv("REDIS_URL")
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal(err)
	}
	client := redis.NewClient(options)
	limit := 10
	if value, err := strconv.Atoi(os.Getenv("QUOTA_LIMIT")); err == nil && value > 0 {
		limit = value
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "quota-api"})
	})
	mux.HandleFunc("/quota", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("force_error") == "true" || os.Getenv("SCENARIO_MODE") == "quota-errors" && rand.Intn(100) < 70 {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"allowed": false, "reason": "quota decision failed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		key := "quota:staging:deployments"
		used, err := client.Incr(ctx, key).Result()
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "redis unavailable"})
			return
		}
		if used == 1 {
			_ = client.Expire(ctx, key, 24*time.Hour).Err()
		}
		writeJSON(w, http.StatusOK, map[string]any{"allowed": used <= int64(limit), "used": used, "limit": limit})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("quota-api listening on %s", port)
	log.Fatal(server.ListenAndServe())
}
