import os

from openfeature import api
from openfeature.contrib.hook.opentelemetry import TracingHook
from openfeature.contrib.provider.flagd import FlagdProvider


def init(provider=None):
    """Registers the flagd provider (gRPC 8013) and the OpenTelemetry hook that records evaluations on the active span."""
    api.set_provider(provider or FlagdProvider(host=os.getenv("FLAGD_HOST", "flagd"), port=8013, deadline_ms=250))
    api.add_hooks([TracingHook()])


def enabled(key):
    """Evaluates a scenario flag per call; any provider error means false (stable behavior)."""
    try:
        return api.get_client().get_boolean_value(key, False)
    except Exception:
        return False
