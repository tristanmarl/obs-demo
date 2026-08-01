# Summarize an incident-assistant trace

Summarize the optional `platform-api -> incident-assistant -> mock-llm` path. Use `gen_ai.operation.name`, provider, model, token counts, latency, and HTTP status. Never reproduce prompt or response bodies. If `ai-latency` is active, call out the mock model delay and distinguish it from platform or database latency.
