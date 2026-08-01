import Fastify from "fastify";
import k8s from "@kubernetes/client-node";
import { parseResourceAttrs } from "./resource-attrs.js";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const urls = {
  artifact: process.env.ARTIFACT_URL || "http://artifact-api:8080",
  quota: process.env.QUOTA_URL || "http://quota-api:8080",
  release: process.env.RELEASE_URL || "http://release-api:8080",
  incident: process.env.INCIDENT_ASSISTANT_URL || "http://incident-assistant:8080",
};
const controlsEnabled = process.env.DEMO_CONTROLS_ENABLED !== "false";
const NS = "nebulatrace";
const DATA_NS = "nebulatrace-data";
const PATCH = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
const MERGE = { headers: { "Content-Type": "application/merge-patch+json" } };
const scenarioDeployments = ["artifact-api", "deployment-worker", "quota-api", "mock-llm", "release-api", "runner-agent"];
const contextAppDeployments = [
  "engineering-portal", "platform-api", "artifact-api", "release-api", "quota-api",
  "deployment-worker", "audit-api", "incident-assistant", "mock-llm", "webhook-function",
  "runner-agent", "load-generator",
];
const contextData = [
  ["deployment", "redis"],
  ["statefulset", "postgres"],
  ["statefulset", "activemq"],
];

const scenarios = [
  { id: "database-latency", label: "Database latency", signal: "PostgreSQL", affectedService: "artifact-api", expectedSymptom: "Artifact catalog requests spend two seconds in the database." },
  { id: "queue-backlog", label: "Queue backlog", signal: "ActiveMQ", affectedService: "deployment-worker", expectedSymptom: "Deployment messages wait before acknowledgement." },
  { id: "quota-errors", label: "Quota errors", signal: "HTTP 500 + Redis", affectedService: "quota-api", expectedSymptom: "Quota checks frequently fail with HTTP 500." },
  { id: "mesh-aborts", label: "Mesh aborts", signal: "Istio HTTP 503", affectedService: "quota-api", expectedSymptom: "Half of quota requests fail before reaching the pod." },
  { id: "runner-deadline", label: "Runner deadline", signal: "gRPC", affectedService: "runner-agent", expectedSymptom: "Release execution exceeds the worker deadline." },
  { id: "ai-latency", label: "AI latency", signal: "GenAI", affectedService: "mock-llm", expectedSymptom: "Incident recommendations wait on a degraded mock model." },
  { id: "allocation-pressure", label: "Allocation pressure", signal: "Java memory", affectedService: "artifact-api", expectedSymptom: "Artifact metadata allocations and survivors increase within a bounded ceiling." },
  { id: "combined-incident", label: "Combined incident", signal: "Database + queue + quota", affectedService: "selected services", expectedSymptom: "Three independent delivery signals degrade together." },
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
    hosts: ["quota-api.nebulatrace.svc.cluster.local"],
    http: [{
      ...(aborted ? { fault: { abort: { percentage: { value: 50 }, httpStatus: 503 } } } : {}),
      route: [{ destination: { host: "quota-api.nebulatrace.svc.cluster.local", subset: "stable", port: { number: 8080 } } }],
    }],
  };
  return customApi.patchNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "quota-api", { spec }, undefined, undefined, undefined, MERGE);
}

async function resetScenarios() {
  await Promise.all([...scenarioDeployments.map(name => patchDeployment(name, "stable")), patchVirtualService(false)]);
}

async function applyScenario(id) {
  if (!controlsEnabled) throw Object.assign(new Error("demo controls are disabled"), { statusCode: 404 });
  if (!scenarios.some(scenario => scenario.id === id)) throw Object.assign(new Error(`unknown scenario: ${id}`), { statusCode: 400 });
  await resetScenarios();
  const targets = {
    "database-latency": [["artifact-api", "database-latency"]],
    "queue-backlog": [["deployment-worker", "queue-backlog"]],
    "quota-errors": [["quota-api", "quota-errors"]],
    "mesh-aborts": [],
    "runner-deadline": [["runner-agent", "runner-deadline"]],
    "ai-latency": [["mock-llm", "ai-latency"]],
    "allocation-pressure": [["artifact-api", "allocation-pressure"]],
    "combined-incident": [["artifact-api", "database-latency"], ["deployment-worker", "queue-backlog"], ["quota-api", "quota-errors"]],
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
    } catch {
      modes[name] = "unknown";
    }
  }));
  let meshAborted = false;
  try {
    const result = await customApi.getNamespacedCustomObject("networking.istio.io", "v1", NS, "virtualservices", "quota-api");
    const fault = result.body.spec?.http?.[0]?.fault?.abort;
    meshAborted = fault?.httpStatus === 503 && fault?.percentage?.value === 50;
  } catch { /* local Docker has no Istio API */ }
  const active = meshAborted ? "mesh-aborts"
    : modes.artifact-api === "database-latency" && modes.deployment-worker === "queue-backlog" && modes.quota-api === "quota-errors" ? "combined-incident"
      : scenarios.find(scenario => scenario.id !== "combined-incident" && modes[scenario.affectedService] === scenario.id)?.id || null;
  return { activeScenario: active, modes, meshAborted };
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

async function proxy(reply, url, options) {
  const result = await getJson(url, options);
  reply.code(result.statusCode);
  return result.body;
}

function releaseError(body) {
  if (!body || typeof body !== "object") return "release body must be an object";
  if (!/^[a-z0-9._-]{1,80}$/.test(body.service || "")) return "service must be 1-80 lowercase letters, numbers, -, _, or .";
  if (!/^\S{1,80}$/.test(body.version || "")) return "version must be 1-80 non-whitespace characters";
  if (!["development", "test", "staging", "production"].includes(body.environment)) return "environment must be development, test, staging, or production";
  return null;
}

app.get("/healthz", async () => ({ ok: true, service: "platform-api" }));
app.get("/api/status", async () => ({ controlApi: "connected", demoControlsEnabled: controlsEnabled }));
app.get("/api/artifacts", async (_request, reply) => proxy(reply, `${urls.artifact}/artifacts`));
app.get("/api/quota", async (request, reply) => proxy(reply, `${urls.quota}/quota${request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : ""}`));
app.post("/api/releases", async (request, reply) => {
  const error = releaseError(request.body);
  if (error) { reply.code(400); return { error }; }
  return proxy(reply, `${urls.release}/releases`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request.body) });
});
app.get("/api/incidents/recommendation", async (_request, reply) => proxy(reply, `${urls.incident}/recommendation`));
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
