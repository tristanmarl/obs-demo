import Fastify from "fastify";
import k8s from "@kubernetes/client-node";
import { applyDocument, describePlan, loadDocument, planDocument } from "./attributes-store.js";
import { WORKLOADS, effectiveAll, validateDocument } from "./attributes.js";
import { SCENARIO_FLAGS, deriveScenario, flagDocument, readFlags } from "./flags.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const urls = {
  catalog: process.env.CATALOG_URL || "http://catalog-api:8080",
  cache: process.env.CACHE_URL || "http://cache-api:8080",
  job: process.env.JOB_URL || "http://job-api:8080",
  analysis: process.env.ANALYSIS_URL || "http://analysis-api:8080",
};
const controlsEnabled = process.env.DEMO_CONTROLS_ENABLED !== "false";
const NS = "obs-demo";
const MERGE = { headers: { "Content-Type": "application/merge-patch+json" } };
const FLAGS_CONFIGMAP = "obs-demo-flags";
const FLAGS_KEY = "flags.json";
const tenantUrl = /\.invalid\/?$/.test(process.env.DT_TENANT_URL || "") ? "" : (process.env.DT_TENANT_URL || "").replace(/\/+$/, "");

const scenarios = [
  { id: "database-latency", label: "Database latency", signal: "PostgreSQL", affectedService: "catalog-api", expectedSymptom: "Catalog requests spend two seconds in PostgreSQL.", service: "catalog-api", lookIn: [{"text": "Services: catalog-api response time and the PostgreSQL database span", "dql": "fetch spans | filter feature_flag.key == \"database-latency\" | limit 20"}] },
  { id: "queue-backlog", label: "Queue backlog", signal: "ActiveMQ", affectedService: "job-worker", expectedSymptom: "Jobs wait before acknowledgement.", service: "job-worker", lookIn: [{"text": "ActiveMQ queue depth and job-worker process spans", "dql": "timeseries max(obs_demo_jobs_pending), by: {variant}"}] },
  { id: "cache-errors", label: "Cache errors", signal: "HTTP 500 + Redis", affectedService: "cache-api", expectedSymptom: "Cache operations frequently return HTTP 500.", service: "cache-api", lookIn: [{"text": "Services: cache-api failure rate", "dql": "fetch spans | filter feature_flag.key == \"cache-errors\" | limit 20"}] },
  { id: "mesh-aborts", label: "Mesh aborts", signal: "Istio HTTP 503", affectedService: "cache-api", expectedSymptom: "Half of cache requests fail before pod invocation.", service: "cache-api", lookIn: [{"text": "Istio request metrics for cache-api (HTTP 503)", "dql": "timeseries sum(istio_requests_total), by: {response_code}"}] },
  { id: "grpc-deadline", label: "gRPC deadline", signal: "gRPC", affectedService: "grpc-service", expectedSymptom: "A unary RPC exceeds the worker deadline.", service: "grpc-service", lookIn: [{"text": "job-worker to grpc-service ExecuteJob, DEADLINE_EXCEEDED", "dql": "fetch spans | filter feature_flag.key == \"grpc-deadline\" | limit 20"}] },
  { id: "ai-latency", label: "AI latency", signal: "GenAI", affectedService: "mock-llm", expectedSymptom: "Analysis waits on a delayed mock model.", service: "mock-llm", lookIn: [{"text": "gen_ai spans of mock-llm", "dql": "fetch spans | filter feature_flag.key == \"ai-latency\" | limit 20"}] },
  { id: "allocation-pressure", label: "Allocation pressure", signal: "Java memory", affectedService: "catalog-api", expectedSymptom: "Catalog allocations and survivors rise within a bounded ceiling.", service: "catalog-api", lookIn: [{"text": "catalog-api JVM memory and buildCatalogBatch", "dql": "fetch spans | filter feature_flag.key == \"allocation-pressure\" | limit 20"}] },
  { id: "host-db-latency", label: "Host DB latency", signal: "MariaDB on EC2 (otel:process)", affectedService: "result-api", expectedSymptom: "Result writes wait two seconds in the host MariaDB process.", service: "result-api", lookIn: [{"text": "result-api spans and the mariadbd process on the EC2 host", "dql": "fetch spans | filter feature_flag.key == \"host-db-latency\" | limit 20"}] },
  { id: "combined-failure", label: "Combined failure", signal: "PostgreSQL + ActiveMQ + Redis", affectedService: "selected services", expectedSymptom: "Three independent distributed-system signals degrade together.", service: "gateway-api", lookIn: [{"text": "Start at gateway-api, then follow catalog, jobs and cache edges", "dql": "fetch spans | filter in(feature_flag.key, array(\"database-latency\", \"queue-backlog\", \"cache-errors\")) | limit 20"}] },
];

const kc = new k8s.KubeConfig();
try { kc.loadFromCluster(); } catch { try { kc.loadFromDefault(); } catch { /* local Docker has no Kubernetes client config */ } }
let appsApi;
let customApi;
let coreApi;
const cluster = kc.getCurrentCluster();
if (cluster?.server && !cluster.server.includes("undefined")) {
  try {
    appsApi = kc.makeApiClient(k8s.AppsV1Api);
    customApi = kc.makeApiClient(k8s.CustomObjectsApi);
    coreApi = kc.makeApiClient(k8s.CoreV1Api);
  } catch { /* mutation routes report that Kubernetes is unavailable */ }
}

function requireKubernetes() {
  if (!appsApi || !customApi || !coreApi) throw Object.assign(new Error("Kubernetes API unavailable"), { statusCode: 503 });
}

async function readFlagDocument() {
  requireKubernetes();
  const result = await coreApi.readNamespacedConfigMap(FLAGS_CONFIGMAP, NS);
  return JSON.parse(result.body.data?.[FLAGS_KEY] || "{}");
}

async function writeFlags(enabled) {
  requireKubernetes();
  const data = { [FLAGS_KEY]: JSON.stringify(flagDocument(enabled), null, 2) };
  return coreApi.patchNamespacedConfigMap(FLAGS_CONFIGMAP, NS, { data }, undefined, undefined, undefined, undefined, undefined, MERGE);
}

async function patchVirtualService(aborted) {
  requireKubernetes();
  const spec = {
    hosts: ["cache-api.obs-demo.svc.cluster.local"],
    http: [{
      ...(aborted ? { fault: { abort: { percentage: { value: 50 }, httpStatus: 503 } } } : {}),
      route: [{ destination: { host: "cache-api.obs-demo.svc.cluster.local", subset: "stable", port: { number: 8080 } } }],
    }],
  };
  return customApi.patchNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "cache-api", { spec }, undefined, undefined, undefined, MERGE);
}

async function resetScenarios() {
  await Promise.all([writeFlags([]), patchVirtualService(false)]);
}

async function applyScenario(id) {
  if (!controlsEnabled) throw Object.assign(new Error("demo controls are disabled"), { statusCode: 404 });
  if (!scenarios.some(scenario => scenario.id === id)) throw Object.assign(new Error(`unknown scenario: ${id}`), { statusCode: 400 });
  // Reset and enable in one flag patch; the VirtualService is stable unless the scenario is mesh-aborts.
  await Promise.all([writeFlags(SCENARIO_FLAGS[id]), patchVirtualService(id === "mesh-aborts")]);
  return { ok: true, scenario: id };
}

async function readState() {
  if (!appsApi || !customApi || !coreApi) return { activeScenario: null, flags: {}, meshAborted: false, stateAvailable: false };
  let flags;
  try { flags = readFlags(await readFlagDocument()); } catch { return { activeScenario: null, flags: {}, meshAborted: false, stateAvailable: false }; }
  let meshAborted = false;
  try {
    const result = await customApi.getNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "cache-api");
    const fault = result.body.spec?.http?.[0]?.fault?.abort;
    meshAborted = fault?.httpStatus === 503 && fault?.percentage?.value === 50;
  } catch { /* local Docker has no Istio API */ }
  return { activeScenario: deriveScenario(flags, meshAborted), flags, meshAborted, stateAvailable: true };
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
app.get("/api/status", async () => ({ controlApi: "connected", demoControlsEnabled: controlsEnabled, ...(tenantUrl ? { tenantUrl } : {}) }));
// flagd polls this over the mesh. The ingress VirtualService routes only /api, so /internal is not reachable from outside.
app.get("/internal/flags.json", async (_request, reply) => {
  try { return await readFlagDocument(); } catch (error) { reply.code(503); return { error: error.message }; }
});
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
const attributeError = (reply, error) => {
  reply.code(error.code === "INVALID_RESOURCE_ATTRIBUTES" ? 400 : error.statusCode || 500);
  return { error: error.message };
};
const mutationsDisabled = reply => { reply.code(404); return { error: "demo controls are disabled" }; };

app.get("/api/attributes", async (_request, reply) => {
  try {
    requireKubernetes();
    const document = await loadDocument(coreApi);
    return { controlsEnabled, workloads: WORKLOADS, document, activePreset: document.activePreset, effective: effectiveAll(document) };
  } catch (error) { return attributeError(reply, error); }
});
app.post("/api/attributes/preview", async (request, reply) => {
  if (!controlsEnabled) return mutationsDisabled(reply);
  try {
    requireKubernetes();
    const document = validateDocument(request.body);
    const plan = await planDocument(appsApi, document);
    return { document, plan: describePlan(plan), restarting: plan.filter(entry => entry.changed).map(entry => entry.workload) };
  } catch (error) { return attributeError(reply, error); }
});
app.post("/api/attributes/apply", async (request, reply) => {
  if (!controlsEnabled) return mutationsDisabled(reply);
  try {
    requireKubernetes();
    return await applyDocument(appsApi, coreApi, request.body);
  } catch (error) { return attributeError(reply, error); }
});

app.listen({ port, host: "0.0.0.0" });
