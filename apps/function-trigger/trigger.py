import json
import os
import time
import urllib.error
import urllib.request
import uuid

import otel_setup
from opentelemetry import metrics, propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://gateway-api:8080").rstrip("/")
DELAY_MS = int(os.getenv("TRIGGER_DELAY_MS", "7000"))
TIMEOUT = float(os.getenv("TRIGGER_TIMEOUT_SECONDS", "5"))
PROVIDER = os.getenv("FAAS_PROVIDER", "aws")
PROVIDER_CONFIG = {
    "aws": {"region": "us-east-1", "event_source": "arn:aws:sns:us-east-1:000000000000:nebulatrace-jobs", "messaging": "aws_sns"},
    "azure": {"region": "westeurope", "event_source": "/subscriptions/00000000/resourceGroups/nebulatrace/providers/Microsoft.EventGrid/topics/jobs-requested", "messaging": "azure_event_grid"},
    "gcp": {"region": "europe-west3", "event_source": "//pubsub.googleapis.com/projects/nebulatrace/topics/jobs-requested", "messaging": "gcp_pubsub"},
}
if PROVIDER not in PROVIDER_CONFIG:
    raise ValueError("FAAS_PROVIDER must be aws, azure, or gcp")
CONFIG = PROVIDER_CONFIG[PROVIDER]
SERVICE_NAME = os.getenv("SERVICE_NAME", "function-trigger")
FUNCTION_NAME = os.getenv("FAAS_FUNCTION_NAME", SERVICE_NAME)
FAAS_VERSION = os.getenv("FAAS_VERSION", "1.0.0")

otel_setup.setup(SERVICE_NAME, extra={
    "faas.name": FUNCTION_NAME,
    "faas.version": FAAS_VERSION,
    "faas.trigger": "pubsub",
    "cloud.provider": PROVIDER,
    "cloud.region": CONFIG["region"],
    "cloud.resource_id": CONFIG["event_source"],
})
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
invocations = meter.create_counter("nebulatrace.function.invocations")
failures = meter.create_counter("nebulatrace.function.failures")
latency = meter.create_histogram("nebulatrace.function.gateway.duration", unit="s")


def invoke_job(headers):
    body = json.dumps({"name": "demo-job", "workUnits": 10}).encode()
    request = urllib.request.Request(
        f"{GATEWAY_URL}/api/jobs", data=body, method="POST",
        headers={"content-type": "application/json", **headers},
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        response.read()
        return response.status, time.monotonic() - started


def main():
    print(json.dumps({"event": f"{SERVICE_NAME}.start", "provider": PROVIDER, "gateway_url": GATEWAY_URL, "delay_ms": DELAY_MS}), flush=True)
    while True:
        invocation_id = f"invoke-{uuid.uuid4().hex[:12]}"
        attributes = {
            "faas.trigger": "pubsub", "faas.invocation_id": invocation_id,
            "messaging.system": CONFIG["messaging"], "messaging.destination.name": "jobs-requested",
            "messaging.operation.name": "process", "messaging.operation.type": "process",
            "messaging.message.id": invocation_id, "cloud.resource_id": CONFIG["event_source"],
        }
        with tracer.start_as_current_span(f"process jobs-requested", kind=SpanKind.CONSUMER, attributes=attributes) as span:
            headers = {}
            propagate.inject(headers)
            try:
                status, elapsed = invoke_job(headers)
                span.set_attribute("http.response.status_code", status)
                latency.record(elapsed, {"cloud.provider": PROVIDER})
                invocations.add(1, {"cloud.provider": PROVIDER})
            except urllib.error.HTTPError as exc:
                failures.add(1, {"cloud.provider": PROVIDER, "failure.type": "http"})
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
            except Exception as exc:
                failures.add(1, {"cloud.provider": PROVIDER, "failure.type": "exception"})
                span.set_status(Status(StatusCode.ERROR, str(exc)))
                span.record_exception(exc)
        time.sleep(max(DELAY_MS, 0) / 1000)


if __name__ == "__main__":
    main()
