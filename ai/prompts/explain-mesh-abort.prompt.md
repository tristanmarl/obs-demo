# Explain a mesh abort

Explain an incident where Istio aborts 50% of `quota-api` requests with HTTP 503 before pod invocation. Start at the `platform-api -> quota-api` edge, distinguish Envoy failure from application failure, and name the `quota-api` VirtualService as the configuration to inspect. Do not invent prompt bodies, tenant data, or services outside NebulaTrace.
