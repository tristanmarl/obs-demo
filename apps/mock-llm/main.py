import time

import flags
import otel_setup
from fastapi import FastAPI
from pydantic import BaseModel
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

otel_setup.setup("mock-llm")
flags.init()
tracer = trace.get_tracer(__name__)
meter = metrics.get_meter(__name__)
llm_calls = meter.create_counter("obs_demo.llm.calls")
llm_tokens = meter.create_counter("obs_demo.llm.tokens")
llm_latency = meter.create_histogram("obs_demo.llm.latency", unit="s")
app = FastAPI(title="mock-llm")
FastAPIInstrumentor.instrument_app(app)
MODEL = "mock-service-analyzer"


class Completion(BaseModel):
    prompt: str


@app.get("/healthz")
def healthz():
    return {"ok": True, "service": "mock-llm"}


@app.post("/complete")
def complete(_request: Completion):
    started = time.monotonic()
    with tracer.start_as_current_span("gen_ai.chat") as span:
        span.set_attribute("gen_ai.operation.name", "chat")
        span.set_attribute("gen_ai.provider.name", "mock")
        span.set_attribute("gen_ai.request.model", MODEL)
        if flags.enabled("ai-latency"):
            time.sleep(2)
        text = "Inspect the failing dependency, queue delay, and downstream status before changing configuration."
        token_count = len(text.split())
        span.set_attribute("gen_ai.response.model", MODEL)
        span.set_attribute("gen_ai.usage.input_tokens", 10)
        span.set_attribute("gen_ai.usage.output_tokens", token_count)
        llm_calls.add(1, {"gen_ai.request.model": MODEL})
        llm_tokens.add(token_count, {"gen_ai.request.model": MODEL})
        llm_latency.record(time.monotonic() - started, {"gen_ai.request.model": MODEL})
        return {"model": MODEL, "analysis": text, "tokens": token_count}
