package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"math/rand"
	"net/http"
	"os"
	"time"

	flagd "github.com/open-feature/go-sdk-contrib/providers/flagd/pkg"
	otelhook "github.com/open-feature/go-sdk-contrib/hooks/open-telemetry/pkg"
	"github.com/open-feature/go-sdk/openfeature"
	"github.com/redis/go-redis/v9"
)

const counterKey = "obs-demo:counter"

func writeJSON(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// flagEnabled evaluates a boolean scenario flag per request; any error yields false (stable behavior).
func flagEnabled(ctx context.Context, client *openfeature.Client, key string) bool {
	value, err := client.BooleanValue(ctx, key, false, openfeature.EvaluationContext{})
	return err == nil && value
}

func main() {
	flagdHost := os.Getenv("FLAGD_HOST")
	if flagdHost == "" {
		flagdHost = "flagd"
	}
	if provider, err := flagd.NewProvider(flagd.WithHost(flagdHost), flagd.WithPort(8013)); err != nil {
		log.Printf("flagd provider unavailable, scenarios stay stable: %v", err)
	} else if err := openfeature.SetProvider(provider); err != nil {
		log.Printf("flagd provider not set: %v", err)
	}
	// cache-api has no OTel SDK, so this hook only records when a span is active in the context.
	openfeature.AddHooks(otelhook.NewTracesHook())
	flags := openfeature.NewClient("cache-api")

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://redis.obs-demo-data:6379"
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal(err)
	}
	client := redis.NewClient(options)

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "cache-api"})
	})
	mux.HandleFunc("/cache", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("force_error") == "true" || (flagEnabled(r.Context(), flags, "error-spike") && rand.Intn(100) < 70) {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "cache operation failed"})
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		var value int64
		if r.Method == http.MethodPost {
			value, err = client.Incr(ctx, counterKey).Result()
			if err == nil && value == 1 {
				err = client.Expire(ctx, counterKey, time.Hour).Err()
			}
		} else if r.Method == http.MethodGet {
			value, err = client.Get(ctx, counterKey).Int64()
			if errors.Is(err, redis.Nil) {
				value, err = 0, nil
			}
		} else {
			w.Header().Set("Allow", "GET, POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		if err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "redis unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"key": counterKey, "value": value})
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("cache-api listening on %s", port)
	log.Fatal(server.ListenAndServe())
}
