import unittest

from openfeature import api
from openfeature.provider.in_memory_provider import InMemoryFlag, InMemoryProvider

import flags


class FlagsTest(unittest.TestCase):
    def test_enabled_reads_provider_and_defaults_to_false(self):
        provider = InMemoryProvider({
            "on-flag": InMemoryFlag("on", {"on": True, "off": False}),
            "off-flag": InMemoryFlag("off", {"on": True, "off": False}),
        })
        flags.init(provider)
        self.assertTrue(flags.enabled("on-flag"))
        self.assertFalse(flags.enabled("off-flag"))
        self.assertFalse(flags.enabled("missing-flag"))
        api.clear_providers()


if __name__ == "__main__":
    unittest.main()
