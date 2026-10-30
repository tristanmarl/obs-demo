package main

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"go.opentelemetry.io/contrib/bridges/otelslog"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlplog/otlploghttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/log/global"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/propagation"
	sdklog "go.opentelemetry.io/otel/sdk/log"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

const name = "obs-edge-agent"

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func parseInterval(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil || d <= 0 {
		return 5 * time.Second
	}
	return d
}

func requestBody() []byte {
	return []byte(`{"name":"edge-batch","workUnits":5}`)
}

func setup(ctx context.Context) (func(context.Context) error, error) {
	res, err := resource.New(ctx,
		resource.WithFromEnv(),
		resource.WithProcessExecutableName(),
		resource.WithProcessPID(),
		resource.WithAttributes(
			semconv.ServiceName(name),
			semconv.ServiceNamespace("obs-demo"),
			semconv.ServiceVersion(env("SERVICE_VERSION", "dev")),
			attribute.String("deployment.environment.name", "demo"),
		),
	)
	if err != nil {
		return nil, err
	}
	te, err := otlptracehttp.New(ctx)
	if err != nil {
		return nil, err
	}
	me, err := otlpmetrichttp.New(ctx)
	if err != nil {
		return nil, err
	}
	le, err := otlploghttp.New(ctx)
	if err != nil {
		return nil, err
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithResource(res), sdktrace.WithBatcher(te))
	mp := sdkmetric.NewMeterProvider(sdkmetric.WithResource(res), sdkmetric.WithReader(sdkmetric.NewPeriodicReader(me, sdkmetric.WithInterval(15*time.Second))))
	lp := sdklog.NewLoggerProvider(sdklog.WithResource(res), sdklog.WithProcessor(sdklog.NewBatchProcessor(le)))
	otel.SetTracerProvider(tp)
	otel.SetMeterProvider(mp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	global.SetLoggerProvider(lp)
	return func(ctx context.Context) error {
		tErr, mErr, lErr := tp.Shutdown(ctx), mp.Shutdown(ctx), lp.Shutdown(ctx)
		for _, err := range []error{tErr, mErr, lErr} {
			if err != nil {
				return err
			}
		}
		return nil
	}, nil
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	shutdown, err := setup(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "otel setup:", err)
		os.Exit(1)
	}
	logger := slog.New(otelslog.NewHandler(name))
	stderr := slog.New(slog.NewTextHandler(os.Stderr, nil))

	tracer := otel.Tracer(name)
	meter := otel.Meter(name)
	submissions, _ := meter.Int64Counter("obs_demo.edge.submissions", metric.WithDescription("Job submissions from the edge host"))
	duration, _ := meter.Float64Histogram("obs_demo.edge.duration", metric.WithUnit("s"), metric.WithDescription("Job submission duration"))

	url := env("INGRESS_URL", "http://127.0.0.1") + "/api/jobs"
	client := &http.Client{Transport: otelhttp.NewTransport(http.DefaultTransport), Timeout: 5 * time.Second}
	interval := parseInterval(env("EDGE_AGENT_INTERVAL", "5s"))
	stderr.Info("started", "url", url, "interval", interval)

	run := func() {
		ctx, span := tracer.Start(ctx, "edge-batch run", trace.WithSpanKind(trace.SpanKindInternal))
		defer span.End()
		start := time.Now()
		outcome := "ok"
		err := submit(ctx, client, url)
		if err != nil {
			outcome = "error"
			span.RecordError(err)
			span.SetStatus(codes.Error, err.Error())
			logger.ErrorContext(ctx, "edge batch failed", "error", err)
			stderr.Error("edge batch failed", "error", err)
		} else {
			logger.InfoContext(ctx, "edge batch submitted", "url", url)
		}
		attrs := metric.WithAttributes(attribute.String("outcome", outcome))
		submissions.Add(ctx, 1, attrs)
		duration.Record(ctx, time.Since(start).Seconds(), attrs)
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	run()
	for {
		select {
		case <-ctx.Done():
			flush, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := shutdown(flush); err != nil {
				stderr.Error("shutdown", "error", err)
			}
			return
		case <-ticker.C:
			run()
		}
	}
}

func submit(ctx context.Context, client *http.Client, url string) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(requestBody()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return nil
}
