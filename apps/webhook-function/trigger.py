import json
import os
import time
import urllib.error
import urllib.request
import uuid

import otel_setup
from opentelemetry import metrics, propagate, trace
from opentelemetry.trace import SpanKind, Status, StatusCode

PLATFORM_URL = os.getenv("PLATFORM_URL", "http://platform-api:8080").rstrip("/")
DELAY_MS = int(os.getenv("WEBHOOK_DELAY_MS", "5000"))
TIMEOUT = float(os.getenv("WEBHOOK_TIMEOUT_SECONDS", "5"))
PROVIDER = os.getenv("FAAS_PROVIDER", "aws")
PROVIDER_CONFIG = {
    "aws": {"region": "us-east-1", "event_source": "arn:aws:sns:us-east-1:424242424242:release-webhooks", "messaging": "aws_sns"},
    "azure": {"region": "westeurope", "event_source": "/subscriptions/mock/resourceGroups/nebulatrace/providers/Microsoft.EventGrid/topics/release-webhooks", "messaging": "eventgrid"},
    "gcp": {"region": "europe-west3", "event_source": "//pubsub.googleapis.com/projects/nebulatrace/topics/release-webhooks", "messaging": "gcp_pubsub"},
}
if PROVIDER not in PROVIDER_CONFIG:
    raise ValueError("FAAS_PROVIDER must be aws, azure, or gcp")
CONFIG = PROVIDER_CONFIG[PROVIDER]
FUNCTION_NAME = os.getenv("FAAS_FUNCTION_NAME", "webhook-function")
FAAS_VERSION = os.getenv("FAAS_VERSION", "1.0.0")

otel_setup.setup("webhook-function", extra={
    "faas.name": FUNCTION_NAME,
    "faas.version": FAAS_VERSION,
    "cloud.provider": PROVIDER,
    "cloud.region": CONFIG["region"],
})
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
invocations = meter.create_counter("nebulatrace.webhook.invocations")
failures = meter.create_counter("nebulatrace.webhook.failures")
latency = meter.create_histogram("nebulatrace.webhook.platform.duration", unit="s")


def invoke_release(headers):
    body = json.dumps({"service": "checkout-service", "version": "1.4.2", "environment": "staging"}).encode()
    request = urllib.request.Request(
        f"{PLATFORM_URL}/api/releases",
        data=body,
        method="POST",
        headers={"content-type": "application/json", **headers},
    )
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        response.read()
        return response.status, time.monotonic() - started


def main():
    print(json.dumps({"event": "webhook-function.start", "provider": PROVIDER, "platform_url": PLATFORM_URL, "delay_ms": DELAY_MS}), flush=True)
    while True:
        invocation_id = f"webhook-{uuid.uuid4().hex[:12]}"
        attributes = {
            "faas.trigger": "pubsub",
            "faas.invocation_id": invocation_id,
            "messaging.system": CONFIG["messaging"],
            "messaging.destination.name": "release-webhooks",
            "messaging.operation.name": "process",
            "messaging.operation.type": "process",
            "messaging.message.id": invocation_id,
            "cloud.resource_id": CONFIG["event_source"],
        }
        with tracer.start_as_current_span("process release webhook", kind=SpanKind.CONSUMER, attributes=attributes) as span:
            headers = {}
            propagate.inject(headers)
            try:
                status, elapsed = invoke_release(headers)
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
