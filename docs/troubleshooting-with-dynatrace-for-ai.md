# Troubleshooting the analysis path

The analysis path is optional: `gateway-api -> analysis-api -> mock-llm`. It is a deterministic local mock, not a real provider.

1. Let `load-generator` run, or `curl -i /api/analysis`.
2. Expect an analysis response and a trace with `gen_ai.*` model/provider/token attributes.
3. In Dynatrace, open the service flow from `gateway-api` to `analysis-api` and then the HTTP call to `mock-llm`; inspect latency and error status.
4. Compare against a stable trace; there is no failure scenario for this path.

Prompt and response bodies are deliberately absent from spans and metrics. A 503 means the mock call failed or timed out; the gateway does not convert that failure to a successful response.
