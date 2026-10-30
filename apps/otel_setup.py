import os

from opentelemetry import metrics, trace
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor


def build_resource(service_name, extra=None):
    # Defaults are overridden by OTEL_RESOURCE_ATTRIBUTES; service.name always comes from code.
    defaults = Resource({
        "service.namespace": "obs-demo",
        "deployment.environment.name": "demo",
        "service.version": os.getenv("SERVICE_VERSION", os.getenv("IMAGE_TAG", "dev")),
    })
    return defaults.merge(Resource.create({"service.name": service_name, **(extra or {})}))


def setup(service_name, extra=None):
    resource = build_resource(service_name, extra)
    trace.set_tracer_provider(TracerProvider(resource=resource))
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"):
        trace.get_tracer_provider().add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    metric_readers = []
    if os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or os.getenv("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"):
        metric_readers.append(PeriodicExportingMetricReader(OTLPMetricExporter()))
    metrics.set_meter_provider(MeterProvider(resource=resource, metric_readers=metric_readers))
