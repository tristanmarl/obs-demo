import os
import time

import otel_setup
import requests
from fastapi import FastAPI, HTTPException
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.trace import Status, StatusCode

otel_setup.setup("incident-assistant")
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
requests_total = meter.create_counter("nebulatrace.incident_assistant.requests")
failures = meter.create_counter("nebulatrace.incident_assistant.failures")
llm_duration = meter.create_histogram("nebulatrace.incident_assistant.llm.duration", unit="s")
app = FastAPI(title="incident-assistant")
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

LLM_URL = os.getenv("LLM_URL", "http://mock-llm:8080")
MODEL = "mock-delivery-advisor"


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "incident-assistant"}


@app.get("/recommendation")
def recommendation():
    with tracer.start_as_current_span("incident-assistant.recommendation") as span:
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", "mock")
        span.set_attribute("gen_ai.request.model", MODEL)
        started = time.monotonic()
        try:
            response = requests.post(
                f"{LLM_URL}/complete",
                json={"prompt": "Suggest the next safe investigation step for the delivery platform."},
                timeout=3,
            )
            response.raise_for_status()
            data = response.json()
            output_tokens = int(data.get("tokens", 0))
            span.set_attribute("gen_ai.response.model", data.get("model", MODEL))
            span.set_attribute("gen_ai.usage.input_tokens", 10)
            span.set_attribute("gen_ai.usage.output_tokens", output_tokens)
            llm_duration.record(time.monotonic() - started, {"gen_ai.provider.name": "mock"})
            requests_total.add(1, {"status": "ok"})
            return data
        except Exception as exc:
            failures.add(1, {"failure.type": type(exc).__name__})
            span.record_exception(exc)
            span.set_status(Status(StatusCode.ERROR, "mock model request failed"))
            raise HTTPException(status_code=503, detail="incident recommendation unavailable") from exc
