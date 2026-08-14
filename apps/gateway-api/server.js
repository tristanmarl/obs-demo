import Fastify from "fastify";
import k8s from "@kubernetes/client-node";
import { parseResourceAttrs } from "./resource-attrs.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const urls = {
  catalog: process.env.CATALOG_URL || "http://catalog-api:8080",
  cache: process.env.CACHE_URL || "http://cache-api:8080",
  job: process.env.JOB_URL || "http://job-api:8080",
  analysis: process.env.ANALYSIS_URL || "http://analysis-api:8080",
};
const controlsEnabled = process.env.DEMO_CONTROLS_ENABLED !== "false";
const NS = "nebulatrace";
const DATA_NS = "nebulatrace-data";
const PATCH = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
const MERGE = { headers: { "Content-Type": "application/merge-patch+json" } };
const scenarioDeployments = ["catalog-api", "job-worker", "cache-api", "mock-llm", "grpc-service"];
const contextAppDeployments = [
  "control-ui", "gateway-api", "catalog-api", "job-api", "cache-api", "job-worker", "result-api",
  "analysis-api", "mock-llm", "aws-lambda-trigger", "azure-functions-trigger",
  "google-cloud-function-trigger", "grpc-service", "load-generator",
  "cache-exporter", "queue-exporter",
];
const contextData = [["deployment", "redis"], ["statefulset", "postgres"], ["statefulset", "activemq"]];

const scenarios = [
  { id: "database-latency", label: "Database latency", signal: "PostgreSQL", affectedService: "catalog-api", expectedSymptom: "Catalog requests spend two seconds in PostgreSQL." },
  { id: "queue-backlog", label: "Queue backlog", signal: "ActiveMQ", affectedService: "job-worker", expectedSymptom: "Jobs wait before acknowledgement." },
  { id: "cache-errors", label: "Cache errors", signal: "HTTP 500 + Redis", affectedService: "cache-api", expectedSymptom: "Cache operations frequently return HTTP 500." },
  { id: "mesh-aborts", label: "Mesh aborts", signal: "Istio HTTP 503", affectedService: "cache-api", expectedSymptom: "Half of cache requests fail before pod invocation." },
  { id: "grpc-deadline", label: "gRPC deadline", signal: "gRPC", affectedService: "grpc-service", expectedSymptom: "A unary RPC exceeds the worker deadline." },
  { id: "ai-latency", label: "AI latency", signal: "GenAI", affectedService: "mock-llm", expectedSymptom: "Analysis waits on a delayed mock model." },
  { id: "allocation-pressure", label: "Allocation pressure", signal: "Java memory", affectedService: "catalog-api", expectedSymptom: "Catalog allocations and survivors rise within a bounded ceiling." },
  { id: "combined-failure", label: "Combined failure", signal: "PostgreSQL + ActiveMQ + Redis", affectedService: "selected services", expectedSymptom: "Three independent distributed-system signals degrade together." },
];

const kc = new k8s.KubeConfig();
try { kc.loadFromCluster(); } catch { try { kc.loadFromDefault(); } catch { /* local Docker has no Kubernetes client config */ } }
let appsApi;
let customApi;
const cluster = kc.getCurrentCluster();
if (cluster?.server && !cluster.server.includes("undefined")) {
  try {
    appsApi = kc.makeApiClient(k8s.AppsV1Api);
    customApi = kc.makeApiClient(k8s.CustomObjectsApi);
  } catch { /* mutation routes report that Kubernetes is unavailable */ }
}

function requireKubernetes() {
  if (!appsApi || !customApi) throw Object.assign(new Error("Kubernetes API unavailable"), { statusCode: 503 });
}

function envPatch(containerName, envName, envValue) {
  return {
    spec: {
      template: {
        metadata: { annotations: { "kubectl.kubernetes.io/restartedAt": new Date().toISOString() } },
        spec: { containers: [{ name: containerName, env: [{ name: envName, value: envValue }] }] },
      },
    },
  };
}

async function patchDeployment(name, value) {
  requireKubernetes();
  return appsApi.patchNamespacedDeployment(name, NS, envPatch(name, "SCENARIO_MODE", value), undefined, undefined, undefined, undefined, undefined, PATCH);
}

async function patchVirtualService(aborted) {
  requireKubernetes();
  const spec = {
    hosts: ["cache-api.nebulatrace.svc.cluster.local"],
    http: [{
      ...(aborted ? { fault: { abort: { percentage: { value: 50 }, httpStatus: 503 } } } : {}),
      route: [{ destination: { host: "cache-api.nebulatrace.svc.cluster.local", subset: "stable", port: { number: 8080 } } }],
    }],
  };
  return customApi.patchNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "cache-api", { spec }, undefined, undefined, undefined, MERGE);
}

async function resetScenarios() {
  await Promise.all([...scenarioDeployments.map(name => patchDeployment(name, "stable")), patchVirtualService(false)]);
}

async function applyScenario(id) {
  if (!controlsEnabled) throw Object.assign(new Error("demo controls are disabled"), { statusCode: 404 });
  if (!scenarios.some(scenario => scenario.id === id)) throw Object.assign(new Error(`unknown scenario: ${id}`), { statusCode: 400 });
  await resetScenarios();
  const targets = {
    "database-latency": [["catalog-api", "database-latency"]],
    "queue-backlog": [["job-worker", "queue-backlog"]],
    "cache-errors": [["cache-api", "cache-errors"]],
    "mesh-aborts": [],
    "grpc-deadline": [["grpc-service", "grpc-deadline"]],
    "ai-latency": [["mock-llm", "ai-latency"]],
    "allocation-pressure": [["catalog-api", "allocation-pressure"]],
    "combined-failure": [["catalog-api", "database-latency"], ["job-worker", "queue-backlog"], ["cache-api", "cache-errors"]],
  }[id];
  await Promise.all(targets.map(([name, mode]) => patchDeployment(name, mode)));
  if (id === "mesh-aborts") await patchVirtualService(true);
  return { ok: true, scenario: id };
}

async function readState() {
  if (!appsApi || !customApi) return { activeScenario: null, modes: {}, meshAborted: false, stateAvailable: false };
  const modes = {};
  await Promise.all(scenarioDeployments.map(async name => {
    try {
      const result = await appsApi.readNamespacedDeployment(name, NS);
      const container = result.body.spec.template.spec.containers.find(item => item.name === name);
      modes[name] = container?.env?.find(item => item.name === "SCENARIO_MODE")?.value || "stable";
    } catch { modes[name] = "unknown"; }
  }));
  let meshAborted = false;
  try {
    const result = await customApi.getNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "cache-api");
    const fault = result.body.spec?.http?.[0]?.fault?.abort;
    meshAborted = fault?.httpStatus === 503 && fault?.percentage?.value === 50;
  } catch { /* local Docker has no Istio API */ }
  const combined = modes["catalog-api"] === "database-latency" && modes["job-worker"] === "queue-backlog" && modes["cache-api"] === "cache-errors";
  const active = meshAborted ? "mesh-aborts" : combined ? "combined-failure"
    : scenarios.find(scenario => scenario.id !== "combined-failure" && modes[scenario.affectedService] === scenario.id)?.id || null;
  return { activeScenario: active, modes, meshAborted, stateAvailable: true };
}

async function patchResourceAttrs(attrs) {
  requireKubernetes();
  await Promise.all([
    ...contextAppDeployments.map(name => appsApi.patchNamespacedDeployment(name, NS, envPatch(name, "OTEL_RESOURCE_ATTRIBUTES", attrs), undefined, undefined, undefined, undefined, undefined, PATCH)),
    ...contextData.map(([kind, name]) => {
      const patch = envPatch(name, "OTEL_RESOURCE_ATTRIBUTES", attrs);
      return kind === "deployment"
        ? appsApi.patchNamespacedDeployment(name, DATA_NS, patch, undefined, undefined, undefined, undefined, undefined, PATCH)
        : appsApi.patchNamespacedStatefulSet(name, DATA_NS, patch, undefined, undefined, undefined, undefined, undefined, PATCH);
    }),
  ]);
}

async function getJson(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(3000) });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { body: text }; }
    return { statusCode: response.status, body };
  } catch (error) {
    return { statusCode: 503, body: { error: `downstream unavailable: ${error.message}` } };
  }
}

function proxy(reply, url, options) {
  return getJson(url, options).then(result => { reply.code(result.statusCode); return result.body; });
}

function jobError(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "job body must be an object";
  if (!/^[a-z0-9._-]{1,80}$/.test(body.name || "")) return "name must be 1-80 lowercase letters, numbers, -, _, or .";
  if (!Number.isInteger(body.workUnits) || body.workUnits < 1 || body.workUnits > 100) return "workUnits must be an integer from 1 through 100";
  return null;
}

app.get("/healthz", async () => ({ ok: true, service: "gateway-api" }));
app.get("/api/status", async () => ({ controlApi: "connected", demoControlsEnabled: controlsEnabled }));
app.get("/api/catalog", async (request, reply) => proxy(reply, `${urls.catalog}/catalog${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`));
app.get("/api/catalog/:id", async (request, reply) => proxy(reply, `${urls.catalog}/catalog/${encodeURIComponent(request.params.id)}`));
app.get("/api/cache", async (request, reply) => proxy(reply, `${urls.cache}/cache${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`));
app.post("/api/cache", async (request, reply) => proxy(reply, `${urls.cache}/cache`, { method: "POST" }));
app.post("/api/jobs", async (request, reply) => {
  const error = jobError(request.body);
  if (error) { reply.code(400); return { error }; }
  return proxy(reply, `${urls.job}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) });
});
app.get("/api/jobs", async (request, reply) => proxy(reply, `${urls.job}/jobs${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`));
app.get("/api/jobs/:id", async (request, reply) => proxy(reply, `${urls.job}/jobs/${encodeURIComponent(request.params.id)}`));
app.get("/api/analysis", async (_request, reply) => proxy(reply, `${urls.analysis}/analyze`));
app.get("/api/scenarios", async (_request, reply) => {
  try { return { controlsEnabled, scenarios, ...(await readState()) }; }
  catch (error) { reply.code(503); return { error: `scenario state unavailable: ${error.message}`, controlsEnabled, scenarios }; }
});
app.post("/api/scenarios/reset", async (_request, reply) => {
  if (!controlsEnabled) { reply.code(404); return { error: "demo controls are disabled" }; }
  try { await resetScenarios(); return { ok: true, scenario: null }; }
  catch (error) { reply.code(error.statusCode || 500); return { error: error.message }; }
});
app.post("/api/scenarios/:id", async (request, reply) => {
  try { return await applyScenario(request.params.id); }
  catch (error) { reply.code(error.statusCode || 500); return { error: error.message }; }
});
app.get("/api/resource-attrs", async () => ({ attrs: process.env.OTEL_RESOURCE_ATTRIBUTES || "" }));
app.post("/api/resource-attrs", async (request, reply) => {
  if (!controlsEnabled) { reply.code(404); return { error: "demo controls are disabled" }; }
  try {
    const parsed = parseResourceAttrs(request.body?.attrs);
    await patchResourceAttrs(parsed.attrs);
    return { ok: true, attrs: parsed.attrs };
  } catch (error) {
    reply.code(error.code === "INVALID_RESOURCE_ATTRIBUTES" ? 400 : 500);
    return { error: error.message };
  }
});

app.listen({ port, host: "0.0.0.0" });
