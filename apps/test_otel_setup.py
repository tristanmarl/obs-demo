import os
import unittest
from unittest import mock

import otel_setup


class ResourcePrecedenceTest(unittest.TestCase):
    def test_defaults_apply_without_env(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("OTEL_RESOURCE_ATTRIBUTES", None)
            attrs = otel_setup.build_resource("demo-svc").attributes
        self.assertEqual(attrs["service.name"], "demo-svc")
        self.assertEqual(attrs["service.namespace"], "obs-demo")
        self.assertEqual(attrs["deployment.environment.name"], "demo")

    def test_env_overrides_defaults_but_not_service_name(self):
        env = {"OTEL_RESOURCE_ATTRIBUTES": "service.namespace=other,deployment.environment.name=prod,service.name=evil,team=x"}
        with mock.patch.dict(os.environ, env):
            attrs = otel_setup.build_resource("demo-svc").attributes
        self.assertEqual(attrs["service.namespace"], "other")
        self.assertEqual(attrs["deployment.environment.name"], "prod")
        self.assertEqual(attrs["service.name"], "demo-svc")
        self.assertEqual(attrs["team"], "x")


if __name__ == "__main__":
    unittest.main()
