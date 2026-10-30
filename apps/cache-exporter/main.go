package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/redis/go-redis/v9"
)

const (
	exporter = "cache-exporter"
	variant  = "oneagent"
)

var (
	probeScrapesTotal = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "obs_demo_probe_scrapes_total",
		Help: "Total number of /metrics renders by this exporter.",
	}, []string{"exporter", "variant"})

	probeValue = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "obs_demo_probe_value",
		Help: "Deterministic sawtooth (epoch seconds mod 60) for cross-variant comparison.",
	}, []string{"exporter", "variant"})

	probeBuildInfo = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "obs_demo_probe_build_info",
		Help: "Build information, always 1.",
	}, []string{"exporter", "variant", "version"})

	cacheKeys = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "obs_demo_cache_keys",
		Help: "Number of keys in the Redis database.",
	}, []string{"variant"})

	cacheCounterValue = prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "obs_demo_cache_counter_value",
		Help: "Current value of the demo counter key.",
	}, []string{"variant"})
)

func writeJSON(w http.ResponseWriter, status int, body map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func main() {
	reg := prometheus.NewRegistry()
	reg.MustRegister(probeScrapesTotal, probeValue, probeBuildInfo, cacheKeys, cacheCounterValue)

	version := os.Getenv("SERVICE_VERSION")
	if version == "" {
		version = os.Getenv("IMAGE_TAG")
	}
	if version == "" {
		version = "dev"
	}
	probeBuildInfo.WithLabelValues(exporter, variant, version).Set(1)

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://redis.obs-demo-data:6379"
	}
	options, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatal(err)
	}
	client := redis.NewClient(options)

	// Background poller: refresh Redis-sourced gauges every 15 s.
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if n, err := client.DBSize(ctx).Result(); err == nil {
				cacheKeys.WithLabelValues(variant).Set(float64(n))
			}
			const counterKey = "obs-demo:counter"
			if val, err := client.Get(ctx, counterKey).Int64(); err == nil {
				cacheCounterValue.WithLabelValues(variant).Set(float64(val))
			} else if errors.Is(err, redis.Nil) {
				cacheCounterValue.WithLabelValues(variant).Set(0)
			}
			cancel()
			time.Sleep(15 * time.Second)
		}
	}()

	// Wrap the default handler so we can increment the scrape counter on each render.
	metricsHandler := promhttp.HandlerFor(reg, promhttp.HandlerOpts{})
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "service": "cache-exporter"})
	})
	mux.Handle("/metrics", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		probeScrapesTotal.WithLabelValues(exporter, variant).Inc()
		probeValue.WithLabelValues(exporter, variant).Set(float64(time.Now().Unix() % 60))
		metricsHandler.ServeHTTP(w, r)
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	server := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("cache-exporter listening on %s", port)
	log.Fatal(server.ListenAndServe())
}
