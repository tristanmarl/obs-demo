import json
import os
import queue
import time

import grpc
import jobs_pb2
import jobs_pb2_grpc
import otel_setup
import psycopg
import requests
import stomp
from opentelemetry import metrics, propagate, trace
from opentelemetry.instrumentation.grpc import GrpcInstrumentorClient
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.trace import SpanKind, Status, StatusCode

otel_setup.setup("job-worker")
GrpcInstrumentorClient().instrument()
RequestsInstrumentor().instrument()
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
jobs_processed = meter.create_counter("traceforge.worker.processed")
jobs_failed = meter.create_counter("traceforge.worker.failed")
worker_duration = meter.create_histogram("traceforge.worker.duration", unit="s")
grpc_duration = meter.create_histogram("traceforge.grpc.duration", unit="s")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://traceforge:traceforge@postgres.traceforge-data:5432/traceforge")
RESULT_URL = os.getenv("RESULT_URL", "http://result-api:8080")
GRPC_ADDRESS = os.getenv("GRPC_ADDRESS", "grpc-service:50051")
ACTIVEMQ_HOST = os.getenv("ACTIVEMQ_HOST", "activemq.traceforge-data")
ACTIVEMQ_STOMP_PORT = int(os.getenv("ACTIVEMQ_STOMP_PORT", "61613"))
ACTIVEMQ_USER = os.getenv("ACTIVEMQ_USER", "admin")
ACTIVEMQ_PASSWORD = os.getenv("ACTIVEMQ_PASSWORD", "admin")
JOB_QUEUE = os.getenv("JOB_QUEUE", "/queue/jobs.requested")
SUBSCRIPTION = "job-worker"
deliveries = queue.Queue(maxsize=32)


def job_request(message):
    return jobs_pb2.JobRequest(job_id=message["job_id"], name=message["name"], work_units=message["work_units"])


def call_jobs(message, span):
    deadline = 0.4 if os.getenv("SCENARIO_MODE") == "grpc-deadline" else 3
    with grpc.insecure_channel(GRPC_ADDRESS) as channel:
        stub = jobs_pb2_grpc.JobExecutorStub(channel)
        request = job_request(message)
        for method, call in (
            ("ValidateJob", lambda: stub.ValidateJob(request, timeout=deadline)),
            ("ExecuteJob", lambda: stub.ExecuteJob(request, timeout=deadline)),
            ("VerifyJob", lambda: stub.VerifyJob(jobs_pb2.VerifyJobRequest(job_id=message["job_id"]), timeout=deadline)),
        ):
            started = time.monotonic()
            try:
                reply = call()
            except grpc.RpcError as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, f"{method} failed"))
                return False, exc.details() or exc.code().name
            grpc_duration.record(time.monotonic() - started, {"rpc.method": method})
            accepted = getattr(reply, "accepted", getattr(reply, "healthy", False))
            if not accepted:
                span.set_status(Status(StatusCode.ERROR, f"{method} rejected job"))
                return False, reply.message or f"{method} rejected job"
        return True, "job validated, executed, and verified"


def process_job(message, frame):
    job_id = message["job_id"]
    started = time.monotonic()
    context = propagate.extract(dict(frame.headers))
    with tracer.start_as_current_span("process jobs.requested", context=context, kind=SpanKind.CONSUMER) as span:
        span.set_attribute("messaging.system", "activemq")
        span.set_attribute("messaging.destination.name", "jobs.requested")
        span.set_attribute("messaging.operation.name", "process")
        span.set_attribute("messaging.operation.type", "process")
        span.set_attribute("messaging.message.id", job_id)
        span.set_attribute("job.id", job_id)
        if os.getenv("SCENARIO_MODE") == "queue-backlog":
            time.sleep(3)

        outcome = "succeeded"
        message_text = "job completed"
        grpc_ok = False
        try:
            grpc_ok, message_text = call_jobs(message, span)
            if not grpc_ok:
                outcome = "failed"
        except Exception as exc:
            outcome = "failed"
            message_text = "gRPC job operation failed"
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, message_text))

        db_ok = False
        try:
            with psycopg.connect(DATABASE_URL) as conn:
                conn.execute("update jobs set status = %s, completed_at = now() where id = %s", (outcome, job_id))
            db_ok = True
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "job status update failed"))

        result_ok = False
        if db_ok:
            try:
                response = requests.post(
                    f"{RESULT_URL}/result",
                    json={"job_id": job_id, "status": outcome, "message": message_text},
                    timeout=3,
                )
                response.raise_for_status()
                result_ok = True
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, "result callback failed"))

        success = grpc_ok and db_ok and result_ok
        if success:
            jobs_processed.add(1, {"status": outcome})
        else:
            jobs_failed.add(1, {"status": outcome})
            if span.status.status_code is not StatusCode.ERROR:
                span.set_status(Status(StatusCode.ERROR, "job processing failed"))
        worker_duration.record(time.monotonic() - started, {"status": outcome})
        return success


class JobListener(stomp.ConnectionListener):
    def on_message(self, frame):
        deliveries.put(frame)


def receive_job():
    frame = deliveries.get()
    message = json.loads(frame.body)
    context = propagate.extract(dict(frame.headers))
    with tracer.start_as_current_span("receive jobs.requested", context=context, kind=SpanKind.CLIENT) as span:
        span.set_attribute("messaging.system", "activemq")
        span.set_attribute("messaging.destination.name", "jobs.requested")
        span.set_attribute("messaging.operation.name", "receive")
        span.set_attribute("messaging.operation.type", "receive")
        span.set_attribute("messaging.message.id", message["job_id"])
    return message, frame


def main():
    connection = stomp.Connection12([(ACTIVEMQ_HOST, ACTIVEMQ_STOMP_PORT)])
    connection.set_listener(SUBSCRIPTION, JobListener())
    for attempt in range(30):
        try:
            connection.connect(ACTIVEMQ_USER, ACTIVEMQ_PASSWORD, wait=True)
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(2)
    connection.subscribe(destination=JOB_QUEUE, id=SUBSCRIPTION, ack="client-individual")
    while True:
        try:
            message, frame = receive_job()
            success = process_job(message, frame)
            ack_id = frame.headers["ack"]
            if success:
                connection.ack(id=ack_id, subscription=SUBSCRIPTION)
            else:
                connection.nack(id=ack_id, subscription=SUBSCRIPTION)
        except Exception as exc:
            print(json.dumps({"event": "job-worker.error", "error": str(exc)}), flush=True)
            if "frame" in locals() and frame.headers.get("ack"):
                connection.nack(id=frame.headers["ack"], subscription=SUBSCRIPTION)


if __name__ == "__main__":
    main()
