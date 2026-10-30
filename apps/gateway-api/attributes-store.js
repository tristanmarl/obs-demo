import YAML from "yaml";
import { WORKLOADS, APP_NS, effectiveAll, planWorkload, summarizeDiff, validateDocument } from "./attributes.js";

export const CONFIGMAP = "obs-demo-attributes";
export const CONFIGMAP_KEY = "attributes.yaml";
const PATCH = { headers: { "Content-Type": "application/strategic-merge-patch+json" } };
const MERGE = { headers: { "Content-Type": "application/merge-patch+json" } };
const U = undefined;

export async function loadDocument(core) {
  const result = await core.readNamespacedConfigMap(CONFIGMAP, APP_NS);
  return validateDocument(result.body.data?.[CONFIGMAP_KEY] || "");
}

export async function saveDocument(core, doc) {
  const data = { [CONFIGMAP_KEY]: YAML.stringify(doc, { lineWidth: 0 }) };
  await core.patchNamespacedConfigMap(CONFIGMAP, APP_NS, { data }, U, U, U, U, U, MERGE);
}

async function readWorkload(apps, workload) {
  const result = workload.kind === "deployment"
    ? await apps.readNamespacedDeployment(workload.name, workload.ns)
    : await apps.readNamespacedStatefulSet(workload.name, workload.ns);
  const template = result.body.spec.template;
  const container = template.spec.containers.find(item => item.name === workload.name);
  const envValue = name => container?.env?.find(item => item.name === name)?.value;
  return {
    live: {
      env: envValue("OTEL_RESOURCE_ATTRIBUTES") || "",
      customProp: envValue("DT_CUSTOM_PROP"),
      annotations: template.metadata?.annotations || {},
    },
    oneagent: template.metadata?.annotations?.["oneagent.dynatrace.com/inject"] === "true",
  };
}

// Compares the effective attributes of the document with what each workload currently runs with.
export async function planDocument(apps, doc) {
  const effective = effectiveAll(doc);
  return Promise.all(WORKLOADS.map(async workload => {
    try {
      const { live, oneagent } = await readWorkload(apps, workload);
      return { ...planWorkload(workload, effective[workload.name], live, oneagent), effective: effective[workload.name] };
    } catch (error) {
      return { workload: workload.name, ns: workload.ns, kind: workload.kind, changed: false, error: `unavailable: ${error.message}`, effective: effective[workload.name] };
    }
  }));
}

// Public shape of a plan entry (no patch body).
export const describePlan = plan => plan.map(({ patch: _patch, ...rest }) => rest);

async function sendDeploymentEvent(entry) {
  const url = process.env.DT_EVENTS_URL;
  const token = process.env.DT_EVENTS_TOKEN;
  if (!url || !token) return;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Api-Token ${token}` },
      body: JSON.stringify({
        eventType: "CUSTOM_DEPLOYMENT",
        title: `Resource attributes updated: ${entry.workload}`,
        entitySelector: `type(SERVICE),entityName.equals("${entry.workload}")`,
        properties: { workload: entry.workload, namespace: entry.ns, change: summarizeDiff(entry.diff).slice(0, 4000) || "annotation sync", source: "obs-demo attributes" },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) console.error(JSON.stringify({ event: "deployment-event.failed", workload: entry.workload, status: response.status }));
  } catch (error) {
    console.error(JSON.stringify({ event: "deployment-event.failed", workload: entry.workload, error: error.message }));
  }
}

export async function applyDocument(apps, core, input) {
  const doc = validateDocument(input);
  const plan = await planDocument(apps, doc);
  await saveDocument(core, doc);
  const changed = plan.filter(entry => entry.changed);
  await Promise.all(changed.map(entry => entry.kind === "deployment"
    ? apps.patchNamespacedDeployment(entry.workload, entry.ns, entry.patch, U, U, U, U, U, PATCH)
    : apps.patchNamespacedStatefulSet(entry.workload, entry.ns, entry.patch, U, U, U, U, U, PATCH)));
  await Promise.all(changed.map(sendDeploymentEvent));
  return { document: doc, plan: describePlan(plan), restarting: changed.map(entry => entry.workload) };
}
