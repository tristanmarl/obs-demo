import os
import time

import otel_setup
import requests
from fastapi import FastAPI, HTTPException
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.trace import Status, StatusCode

otel_setup.setup("analysis-api")
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
requests_total = meter.create_counter("nebulatrace.analysis.requests")
failures = meter.create_counter("nebulatrace.analysis.failures")
llm_duration = meter.create_histogram("nebulatrace.analysis.llm.duration", unit="s")
app = FastAPI(title="analysis-api")
FastAPIInstrumentor.instrument_app(app)
RequestsInstrumentor().instrument()

LLM_URL = os.getenv("LLM_URL", "http://mock-llm:8080")
MODEL = "mock-service-analyzer"


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "analysis-api"}


@app.get("/analyze")
def analyze():
    with tracer.start_as_current_span("analysis.analyze") as span:
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", "mock")
        span.set_attribute("gen_ai.request.model", MODEL)
        started = time.monotonic()
        try:
            response = requests.post(
                f"{LLM_URL}/complete",
                json={"prompt": "Give a short analysis of a generic distributed-system failure."},
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
            raise HTTPException(status_code=503, detail="analysis unavailable") from exc
