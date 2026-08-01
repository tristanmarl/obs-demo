import json
import os
import time

import grpc
import otel_setup
import psycopg
import requests
import stomp
from opentelemetry import metrics, propagate, trace
from opentelemetry.instrumentation.grpc import GrpcInstrumentorClient
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.trace import SpanKind, Status, StatusCode

import runner_pb2
import runner_pb2_grpc

otel_setup.setup("deployment-worker")
GrpcInstrumentorClient().instrument()
RequestsInstrumentor().instrument()
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
deployments_processed = meter.create_counter("nebulatrace.deployments.processed")
deployments_failed = meter.create_counter("nebulatrace.deployments.failed")
deployment_duration = meter.create_histogram("nebulatrace.deployment.duration", unit="s")
runner_duration = meter.create_histogram("nebulatrace.runner.duration", unit="s")

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://nebulatrace:nebulatrace@postgres.nebulatrace-data:5432/nebulatrace")
AUDIT_URL = os.getenv("AUDIT_URL", "http://audit-api:8080")
RUNNER_ADDRESS = os.getenv("RUNNER_ADDRESS", "runner-agent:50051")
ACTIVEMQ_HOST = os.getenv("ACTIVEMQ_HOST", "activemq.nebulatrace-data")
ACTIVEMQ_STOMP_PORT = int(os.getenv("ACTIVEMQ_STOMP_PORT", "61613"))
ACTIVEMQ_USER = os.getenv("ACTIVEMQ_USER", "admin")
ACTIVEMQ_PASSWORD = os.getenv("ACTIVEMQ_PASSWORD", "admin")
DEPLOYMENT_QUEUE = os.getenv("DEPLOYMENT_QUEUE", "/queue/deployments.requested")


def process_release(message, frame):
    release_id = message["release_id"]
    started = time.monotonic()
    context = propagate.extract(dict(frame.headers))
    with tracer.start_as_current_span("process deployments.requested", context=context, kind=SpanKind.CONSUMER) as span:
        span.set_attribute("messaging.system", "activemq")
        span.set_attribute("messaging.destination.name", "deployments.requested")
        span.set_attribute("messaging.operation.name", "process")
        span.set_attribute("messaging.operation.type", "process")
        span.set_attribute("messaging.message.id", release_id)
        span.set_attribute("release.id", release_id)
        if os.getenv("SCENARIO_MODE") == "queue-backlog":
            time.sleep(3)

        outcome = "succeeded"
        message_text = "release executed"
        runner_ok = True
        try:
            runner_started = time.monotonic()
            with grpc.insecure_channel(RUNNER_ADDRESS) as channel:
                stub = runner_pb2_grpc.RunnerStub(channel)
                deadline = 0.4 if os.getenv("SCENARIO_MODE") == "runner-deadline" else 3
                result = stub.ExecuteRelease(
                    runner_pb2.ExecuteReleaseRequest(
                        release_id=release_id,
                        service=message["service"],
                        version=message["version"],
                        environment=message["environment"],
                    ),
                    timeout=deadline,
                )
            message_text = result.message
            runner_duration.record(time.monotonic() - runner_started, {"rpc.method": "Runner.ExecuteRelease"})
        except grpc.RpcError as exc:
            runner_ok = False
            outcome = "failed"
            message_text = exc.details() or exc.code().name
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "runner execution failed"))

        db_ok = False
        try:
            with psycopg.connect(DATABASE_URL) as conn:
                conn.execute("update releases set status = %s where id = %s", (outcome, release_id))
            db_ok = True
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "release status update failed"))

        audit_ok = False
        if db_ok:
            try:
                response = requests.post(
                    f"{AUDIT_URL}/audit",
                    json={"release_id": release_id, "status": outcome, "message": message_text},
                    timeout=3,
                )
                response.raise_for_status()
                audit_ok = True
            except Exception as exc:
                span.record_exception(exc)
                span.set_status(Status(StatusCode.ERROR, "audit callback failed"))

        success = runner_ok and db_ok and audit_ok
        if success:
            deployments_processed.add(1, {"status": outcome})
        else:
            deployments_failed.add(1, {"status": outcome})
        deployment_duration.record(time.monotonic() - started, {"status": outcome})
        return success


class DeploymentListener(stomp.ConnectionListener):
    def __init__(self, connection):
        self.connection = connection

    def on_message(self, frame):
        try:
            success = process_release(json.loads(frame.body), frame)
            ack_id = frame.headers["ack"]
            if success:
                self.connection.ack(id=ack_id, subscription="deployment-worker")
            else:
                self.connection.nack(id=ack_id, subscription="deployment-worker")
        except Exception as exc:
            print(json.dumps({"event": "deployment-worker.error", "error": str(exc)}), flush=True)
            if frame.headers.get("ack"):
                self.connection.nack(id=frame.headers["ack"], subscription="deployment-worker")


def main():
    connection = stomp.Connection12([(ACTIVEMQ_HOST, ACTIVEMQ_STOMP_PORT)])
    connection.set_listener("deployment-worker", DeploymentListener(connection))
    for attempt in range(30):
        try:
            connection.connect(ACTIVEMQ_USER, ACTIVEMQ_PASSWORD, wait=True)
            break
        except Exception:
            if attempt == 29:
                raise
            time.sleep(2)
    connection.subscribe(destination=DEPLOYMENT_QUEUE, id="deployment-worker", ack="client-individual")
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
