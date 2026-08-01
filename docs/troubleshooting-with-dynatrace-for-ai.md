# Troubleshooting the incident assistant

The incident assistant is an optional path from `platform-api` to `incident-assistant` to `mock-llm`. It is a deterministic local mock, not a real provider.

1. Trigger `Incident recommendation` in the portal or `curl -i /api/incidents/recommendation`.
2. Expect a recommendation and a trace with `gen_ai.*` model/provider/token attributes.
3. In Dynatrace, open the service flow from `platform-api` to `incident-assistant` and then the HTTP call to `mock-llm`; inspect latency and error status.
4. Apply the `ai-latency` scenario to make `mock-llm` sleep for two seconds.
5. Reset with `make reset` and confirm recommendation latency returns to baseline.

Prompt and response bodies are deliberately absent from spans and metrics. A 503 means the mock call failed or timed out; the facade does not convert that failure to a successful response.
