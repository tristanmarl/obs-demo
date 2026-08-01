import json
import os
import re
import time
import uuid

import otel_setup
import psycopg
import stomp
from fastapi import FastAPI, HTTPException
from opentelemetry import metrics, propagate, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.trace import SpanKind, Status, StatusCode

otel_setup.setup("release-api")
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
releases_created = meter.create_counter("nebulatrace.releases.created")
release_failures = meter.create_counter("nebulatrace.releases.failures")
db_duration = meter.create_histogram("nebulatrace.release.db.duration", unit="s")
messaging_duration = meter.create_histogram("nebulatrace.release.messaging.duration", unit="s")
app = FastAPI(title="release-api")
FastAPIInstrumentor.instrument_app(app)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nebulatrace:nebulatrace@postgres.nebulatrace-data:5432/nebulatrace")
ACTIVEMQ_HOST = os.getenv("ACTIVEMQ_HOST", "activemq.nebulatrace-data")
ACTIVEMQ_STOMP_PORT = int(os.getenv("ACTIVEMQ_STOMP_PORT", "61613"))
ACTIVEMQ_USER = os.getenv("ACTIVEMQ_USER", "admin")
ACTIVEMQ_PASSWORD = os.getenv("ACTIVEMQ_PASSWORD", "admin")
DEPLOYMENT_QUEUE = os.getenv("DEPLOYMENT_QUEUE", "/queue/deployments.requested")
ENVIRONMENTS = {"development", "test", "staging", "production"}


def validate_release(body):
    if not isinstance(body, dict):
        return "release body must be an object"
    if not isinstance(body.get("service"), str) or not re.fullmatch(r"[a-z0-9._-]{1,80}", body["service"]):
        return "service must be 1-80 lowercase letters, numbers, -, _, or ."
    if not isinstance(body.get("version"), str) or not 1 <= len(body["version"]) <= 80 or any(c.isspace() for c in body["version"]):
        return "version must be 1-80 non-whitespace characters"
    if body.get("environment") not in ENVIRONMENTS:
        return "environment must be development, test, staging, or production"
    return None


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "release-api"}


@app.post("/releases")
def create_release(body: dict):
    error = validate_release(body)
    if error:
        raise HTTPException(status_code=400, detail=error)
    release_id = str(uuid.uuid4())
    payload = {"release_id": release_id, "service": body["service"], "version": body["version"], "environment": body["environment"]}
    with tracer.start_as_current_span("release.create") as span:
        span.set_attribute("release.id", release_id)
        span.set_attribute("release.service", body["service"])
        span.set_attribute("release.version", body["version"])
        span.set_attribute("deployment.environment.name", body["environment"])
        try:
            started = time.monotonic()
            with psycopg.connect(DATABASE_URL) as conn:
                conn.execute(
                    "insert into releases(id, service, version, environment, status, created_at) values (%s, %s, %s, %s, %s, now())",
                    (release_id, body["service"], body["version"], body["environment"], "queued"),
                )
            db_duration.record(time.monotonic() - started, {"db.system": "postgresql"})
        except Exception as exc:
            release_failures.add(1, {"failure.stage": "database"})
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "release persistence failed"))
            raise HTTPException(status_code=503, detail="release persistence failed") from exc

        headers = {"persistent": "true", "release_id": release_id}
        propagate.inject(headers)
        with tracer.start_as_current_span(f"send deployments.requested", kind=SpanKind.PRODUCER) as send_span:
            send_span.set_attribute("messaging.system", "activemq")
            send_span.set_attribute("messaging.destination.name", "deployments.requested")
            send_span.set_attribute("messaging.operation.name", "send")
            send_span.set_attribute("messaging.operation.type", "send")
            send_span.set_attribute("messaging.message.id", release_id)
            try:
                started = time.monotonic()
                connection = stomp.Connection12([(ACTIVEMQ_HOST, ACTIVEMQ_STOMP_PORT)])
                connection.connect(ACTIVEMQ_USER, ACTIVEMQ_PASSWORD, wait=True)
                connection.send(destination=DEPLOYMENT_QUEUE, body=json.dumps(payload), headers=headers)
                connection.disconnect()
                messaging_duration.record(time.monotonic() - started, {"messaging.system": "activemq"})
            except Exception as exc:
                release_failures.add(1, {"failure.stage": "activemq"})
                send_span.record_exception(exc)
                send_span.set_status(Status(StatusCode.ERROR, "deployment message failed"))
                span.record_exception(exc)
                try:
                    with psycopg.connect(DATABASE_URL) as conn:
                        conn.execute("update releases set status = %s where id = %s", ("failed", release_id))
                except Exception:
                    pass
                raise HTTPException(status_code=503, detail="deployment message failed") from exc
    releases_created.add(1, {"environment": body["environment"]})
    return {"release_id": release_id, "status": "queued"}
