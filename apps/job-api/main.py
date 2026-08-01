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
from psycopg.rows import dict_row

otel_setup.setup("job-api")
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
jobs_created = meter.create_counter("nebulatrace.jobs.created")
job_failures = meter.create_counter("nebulatrace.jobs.failures")
db_duration = meter.create_histogram("nebulatrace.job.db.duration", unit="s")
messaging_duration = meter.create_histogram("nebulatrace.job.messaging.duration", unit="s")
app = FastAPI(title="job-api")
FastAPIInstrumentor.instrument_app(app)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nebulatrace:nebulatrace@postgres.nebulatrace-data:5432/nebulatrace")
ACTIVEMQ_HOST = os.getenv("ACTIVEMQ_HOST", "activemq.nebulatrace-data")
ACTIVEMQ_STOMP_PORT = int(os.getenv("ACTIVEMQ_STOMP_PORT", "61613"))
ACTIVEMQ_USER = os.getenv("ACTIVEMQ_USER", "admin")
ACTIVEMQ_PASSWORD = os.getenv("ACTIVEMQ_PASSWORD", "admin")
JOB_QUEUE = os.getenv("JOB_QUEUE", "/queue/jobs.requested")
NAME_PATTERN = re.compile(r"[a-z0-9._-]{1,80}")


def validate_job(body):
    if not isinstance(body, dict):
        return "job body must be an object"
    if not isinstance(body.get("name"), str) or not NAME_PATTERN.fullmatch(body["name"]):
        return "name must be 1-80 lowercase letters, numbers, -, _, or ."
    if isinstance(body.get("workUnits"), bool) or not isinstance(body.get("workUnits"), int) or not 1 <= body["workUnits"] <= 100:
        return "workUnits must be an integer from 1 through 100"
    return None


def job_row(row):
    return {
        "id": row["id"], "name": row["name"], "workUnits": row["work_units"], "status": row["status"],
        "createdAt": row["created_at"], "completedAt": row["completed_at"],
    }


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "job-api"}


@app.post("/jobs")
def create_job(body: dict):
    error = validate_job(body)
    if error:
        raise HTTPException(status_code=400, detail=error)
    job_id = str(uuid.uuid4())
    payload = {"job_id": job_id, "name": body["name"], "work_units": body["workUnits"]}
    with tracer.start_as_current_span("job.create") as span:
        span.set_attribute("job.id", job_id)
        span.set_attribute("job.name", body["name"])
        span.set_attribute("job.work_units", body["workUnits"])
        try:
            started = time.monotonic()
            with psycopg.connect(DATABASE_URL) as conn:
                conn.execute(
                    "insert into jobs(id, name, work_units, status, created_at) values (%s, %s, %s, %s, now())",
                    (job_id, body["name"], body["workUnits"], "queued"),
                )
            db_duration.record(time.monotonic() - started, {"db.system": "postgresql"})
        except Exception as exc:
            job_failures.add(1, {"failure.stage": "database"})
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "job persistence failed"))
            raise HTTPException(status_code=503, detail="job persistence failed") from exc

        headers = {"persistent": "true", "job_id": job_id}
        propagate.inject(headers)
        with tracer.start_as_current_span("send jobs.requested", kind=SpanKind.PRODUCER) as send_span:
            send_span.set_attribute("messaging.system", "activemq")
            send_span.set_attribute("messaging.destination.name", "jobs.requested")
            send_span.set_attribute("messaging.operation.name", "send")
            send_span.set_attribute("messaging.operation.type", "send")
            send_span.set_attribute("messaging.message.id", job_id)
            try:
                started = time.monotonic()
                connection = stomp.Connection12([(ACTIVEMQ_HOST, ACTIVEMQ_STOMP_PORT)])
                connection.connect(ACTIVEMQ_USER, ACTIVEMQ_PASSWORD, wait=True)
                connection.send(destination=JOB_QUEUE, body=json.dumps(payload), headers=headers)
                connection.disconnect()
                messaging_duration.record(time.monotonic() - started, {"messaging.system": "activemq"})
            except Exception as exc:
                job_failures.add(1, {"failure.stage": "activemq"})
                send_span.record_exception(exc)
                send_span.set_status(Status(StatusCode.ERROR, "job message failed"))
                span.record_exception(exc)
                try:
                    with psycopg.connect(DATABASE_URL) as conn:
                        conn.execute("update jobs set status = %s where id = %s", ("failed", job_id))
                except Exception:
                    pass
                raise HTTPException(status_code=503, detail="job message failed") from exc
    jobs_created.add(1)
    return {"jobId": job_id, "status": "queued"}


@app.get("/jobs")
def list_jobs():
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            return [job_row(row) for row in conn.execute(
                "select id, name, work_units, status, created_at, completed_at from jobs order by created_at desc limit 20"
            )]
    except Exception as exc:
        raise HTTPException(status_code=503, detail="job query failed") from exc


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    if not re.fullmatch(r"[a-f0-9-]{1,80}", job_id):
        raise HTTPException(status_code=400, detail="job id is invalid")
    try:
        with psycopg.connect(DATABASE_URL, row_factory=dict_row) as conn:
            row = conn.execute(
                "select id, name, work_units, status, created_at, completed_at from jobs where id = %s", (job_id,)
            ).fetchone()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="job query failed") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job_row(row)
