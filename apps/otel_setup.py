import os

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def setup(service_name, extra=None):
    resource = Resource.create({
        "service.name": service_name,
        "service.namespace": "nebulatrace",
        "deployment.environment.name": "demo",
        "service.version": os.getenv("SERVICE_VERSION", os.getenv("IMAGE_TAG", "dev")),
        **(extra or {}),
    })
    trace.set_tracer_provider(TracerProvider(resource=resource))
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    metric_readers = []
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"):
        metric_readers.append(PeriodicExportingMetricReader(OTLPMetricExporter()))
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=metric_readers))
