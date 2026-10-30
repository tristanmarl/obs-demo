import os
import time
import threading

import otel_setup
import psycopg
from fastapi import FastAPI
from fastapi.responses import Response
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Info,
    generate_latest,
)

otel_setup.setup("queue-exporter")
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)

# ── Prometheus metrics ────────────────────────────────────────────────────────

EXPORTER = "queue-exporter"
VARIANT = "otlp"

probe_scrapes_total = Counter(
    "traceforge_probe_scrapes_total",
    "Total number of /metrics renders by this exporter.",
    ["exporter", "variant"],
)
probe_value = Gauge(
    "traceforge_probe_value",
    "Deterministic sawtooth (epoch seconds mod 60) for cross-variant comparison.",
    ["exporter", "variant"],
)
probe_build_info = Info(
    "traceforge_probe",
    "Build information.",
    ["exporter", "variant"],
)
jobs_gauge = Gauge(
    "traceforge_jobs",
    "Number of jobs by status.",
    ["status", "variant"],
)
jobs_pending = Gauge(
    "traceforge_jobs_pending",
    "Number of jobs in pending/requested state (queue backlog depth).",
    ["variant"],
)

version = os.getenv("SERVICE_VERSION", os.getenv("IMAGE_TAG", "dev"))
probe_build_info.labels(exporter=EXPORTER, variant=VARIANT).info({"version": version})

# ── OTel metrics (OTLP path) ──────────────────────────────────────────────────

polls_total = meter.create_counter(
    "traceforge.queue_exporter.polls",
    description="Number of Postgres poll cycles completed.",
)

# ── FastAPI app ───────────────────────────────────────────────────────────────

app = FastAPI(title="queue-exporter")
FastAPIInstrumentor.instrument_app(app)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://traceforge:traceforge@postgres.traceforge-data:5432/traceforge",
)


def _poll_postgres() -> None:
    """Background thread: refresh job gauges from Postgres every 15 s."""
    while True:
        with tracer.start_as_current_span("queue.poll") as span:
            try:
                with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
                    rows = conn.execute(
                        "SELECT status, COUNT(*) FROM jobs GROUP BY status"
                    ).fetchall()
                pending = 0
                for status, count in rows:
                    jobs_gauge.labels(status=status, variant=VARIANT).set(count)
                    if status in ("pending", "requested"):
                        pending += count
                jobs_pending.labels(variant=VARIANT).set(pending)
                polls_total.add(1, {"status": "ok"})
                span.set_attribute("db.row_count", len(rows))
            except Exception as exc:
                span.record_exception(exc)
                polls_total.add(1, {"status": "error"})
        time.sleep(15)


# Start background poller once at startup.
_poller = threading.Thread(target=_poll_postgres, daemon=True)
_poller.start()


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "queue-exporter"}


@app.get("/metrics")
def metrics_endpoint():
    probe_scrapes_total.labels(exporter=EXPORTER, variant=VARIANT).inc()
    probe_value.labels(exporter=EXPORTER, variant=VARIANT).set(int(time.time()) % 60)
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
