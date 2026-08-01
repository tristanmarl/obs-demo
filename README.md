# NebulaTrace

NebulaTrace is a small Kubernetes workload for exploring observability in a distributed system. It generates connected HTTP, database, Redis, messaging, gRPC, simulated FaaS, AI, service-map, and memory-profiling signals using both OneAgent and OpenTelemetry.

## Architecture

```text
control-ui / load-generator -> gateway-api
aws-lambda-trigger ---------> gateway-api
azure-functions-trigger ----> gateway-api
google-cloud-function-trigger -> gateway-api

gateway-api -> catalog-api -> PostgreSQL
gateway-api -> cache-api -> Redis
gateway-api -> analysis-api -> mock-llm
gateway-api -> job-api -> PostgreSQL -> ActiveMQ jobs.requested
job-worker -> grpc-service (ValidateJob, ExecuteJob, VerifyJob) -> result-api
```

The control UI submits an asynchronous job, queries catalog data, calls Redis, calls the optional AI path, applies deterministic failure scenarios, and edits shared telemetry context for a private demo environment. It does not imitate a company or business process.

## Run it

Prerequisites: Docker, `kubectl`, `helm`, `istioctl`, and `envsubst`. Builds and tests run in containers; local Node, Go, Java, and Python packages are not required.

```bash
cp .env.example .env
make verify
make k3s-deploy
make app-url
```

For an existing Istio and Dynatrace Operator installation:

```bash
kubectl apply -f https://raw.githubusercontent.com/tristanmarl/nebulatrace/main/deploy/dist/nebulatrace.yaml
```

For a full setup, provide an environment Access Token and run `setup.sh`. The script uses the canonical app manifest and a stable Dynatrace Operator release.

## Controls

Failure scenarios are deterministic and backend-derived. Applying one resets all targets before enabling it. **Demo telemetry context** validates and patches only the explicit application/data allowlist, then restarts those workloads. Set `DEMO_CONTROLS_ENABLED=false` before exposing ingress publicly; these private-demo controls intentionally have no production authentication.

```bash
make reset
./scripts/reset-demo.sh
```

Normal load includes a configurable background error rate (`LOADGEN_ERROR_RATE`, default `0.05`). Failures rotate through cache 500s, missing catalog items, and invalid jobs; targeted scenarios remain available for dependency and infrastructure failures.

## Configuration

Important defaults are in `.env.example`: `LOADGEN_DELAY_MS`, `LOADGEN_ERROR_RATE`, `MEMORY_PRESSURE_MB`, `MEMORY_SURVIVOR_BATCHES`, `FAAS_VERSION`, and `DEMO_CONTROLS_ENABLED`. The Java allocation scenario accepts 1–32 MB per batch and retains at most 1–16 batches.

## Verification

```bash
make verify
```

The target checks shell syntax, resource-attribute validation, Python syntax, Go tests, the UI build, the bounded Java test, the gRPC contract check, every service image, stale vocabulary/secrets, and reproducible manifest rendering with no unresolved placeholders. When a cluster is available:

```bash
make k3s-load-images
IMAGE_REGISTRY=nebulatrace IMAGE_TAG=dev ./scripts/deploy-demo.sh
kubectl -n nebulatrace get pods
kubectl -n nebulatrace-data get pods
```
