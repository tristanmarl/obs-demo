import YAML from "yaml";

export const APP_NS = "obs-demo";
export const DATA_NS = "obs-demo-data";
export const WORKLOADS = [
  ...["control-ui", "gateway-api", "catalog-api", "job-api", "cache-api", "job-worker", "result-api",
    "analysis-api", "mock-llm", "aws-lambda-trigger", "azure-functions-trigger",
    "google-cloud-function-trigger", "grpc-service", "load-generator", "cache-exporter", "queue-exporter", "flagd",
  ].map(name => ({ name, ns: APP_NS, kind: "deployment" })),
  { name: "redis", ns: DATA_NS, kind: "deployment" },
  { name: "postgres", ns: DATA_NS, kind: "statefulset" },
  { name: "activemq", ns: DATA_NS, kind: "statefulset" },
];
export const ANNOTATION_PREFIX = "metadata.dynatrace.com/";
export const PRESERVED_ANNOTATIONS = new Set(["service"]);

const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FORBIDDEN = new Set(["service.name", "service.instance.id"]);
const MAX_ENTRIES = 32;
const MAX_CHARS = 2048;

const invalid = message => Object.assign(new Error(message), { code: "INVALID_RESOURCE_ATTRIBUTES" });
const isObject = value => value && typeof value === "object" && !Array.isArray(value);

// Validates one layer and returns it with string values. Rules are the resource-attribute trust boundary.
export function checkAttributes(layer, where) {
  if (layer === undefined || layer === null) return {};
  if (!isObject(layer)) throw invalid(`${where} must be a map of key: value`);
  const out = {};
  for (const [key, raw] of Object.entries(layer)) {
    if (!KEY.test(key)) throw invalid(`${where}: invalid key '${key}'; use letters, numbers, _, -, and .`);
    if (FORBIDDEN.has(key)) throw invalid(`${where}: ${key} is workload-specific and cannot be changed`);
    if (isObject(raw) || Array.isArray(raw) || raw === null || raw === undefined) throw invalid(`${where}: value for '${key}' must be a scalar`);
    const value = String(raw).trim();
    if (!value) throw invalid(`${where}: value for '${key}' must not be empty`);
    if (/[,\n\r]/.test(value)) throw invalid(`${where}: value for '${key}' must not contain commas or line breaks`);
    if (key.length > 63 || !/[A-Za-z0-9]$/.test(key)) throw invalid(`${where}: '${key}' becomes a pod annotation name; use at most 63 characters and end with a letter or number`);
    out[key] = value;
  }
  return out;
}

export function toEnv(attrs) {
  return Object.keys(attrs).sort().map(key => `${key}=${attrs[key]}`).join(",");
}

export function parseEnv(value) {
  const out = {};
  for (const entry of (value || "").split(",")) {
    const separator = entry.indexOf("=");
    if (separator > 0) out[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return out;
}

// OneAgent custom properties: space-separated key=value pairs, so whitespace inside values is replaced.
export function toCustomProp(attrs) {
  return Object.keys(attrs).sort().map(key => `${key}=${attrs[key].replace(/\s+/g, "_")}`).join(" ");
}

export function toAnnotations(attrs) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => [ANNOTATION_PREFIX + key, value]));
}

export function emptyDocument() {
  return { global: {}, teams: {}, workloads: {}, presets: {}, activePreset: "" };
}

// Parses and validates a layer document (object or YAML text); returns the normalized document.
export function validateDocument(input) {
  let doc = input;
  if (typeof input === "string") {
    try { doc = YAML.parse(input); } catch (error) { throw invalid(`attributes document is not valid YAML: ${error.message}`); }
  }
  if (!isObject(doc)) throw invalid("attributes document must be a map");
  for (const key of Object.keys(doc)) {
    if (!["global", "teams", "workloads", "presets", "activePreset"].includes(key)) throw invalid(`unknown top-level key '${key}'`);
  }
  const out = emptyDocument();
  out.global = checkAttributes(doc.global, "global");
  for (const section of ["teams", "presets"]) {
    if (doc[section] !== undefined && doc[section] !== null && !isObject(doc[section])) throw invalid(`${section} must be a map`);
    for (const [name, layer] of Object.entries(doc[section] || {})) {
      if (!NAME.test(name)) throw invalid(`${section}: invalid name '${name}'; use lowercase letters, numbers, and -`);
      out[section][name] = checkAttributes(layer, `${section}.${name}`);
    }
  }
  const known = new Set(WORKLOADS.map(item => item.name));
  if (doc.workloads !== undefined && doc.workloads !== null && !isObject(doc.workloads)) throw invalid("workloads must be a map");
  for (const [name, entry] of Object.entries(doc.workloads || {})) {
    if (!known.has(name)) throw invalid(`workloads: unknown workload '${name}'`);
    if (!isObject(entry)) throw invalid(`workloads.${name} must be a map with team and attributes`);
    const team = entry.team ? String(entry.team) : "";
    if (team && !out.teams[team]) throw invalid(`workloads.${name}: unknown team '${team}'`);
    out.workloads[name] = { team, attributes: checkAttributes(entry.attributes, `workloads.${name}.attributes`) };
  }
  const active = doc.activePreset ? String(doc.activePreset) : "";
  if (active && !out.presets[active]) throw invalid(`activePreset: unknown preset '${active}'`);
  out.activePreset = active;
  effectiveAll(out);
  return out;
}

// Precedence: global -> active preset -> team -> workload.
export function effectiveAttributes(doc, name) {
  const entry = doc.workloads[name] || { team: "", attributes: {} };
  const effective = {
    ...doc.global,
    ...(doc.activePreset ? doc.presets[doc.activePreset] : {}),
    ...(entry.team ? doc.teams[entry.team] : {}),
    ...entry.attributes,
  };
  const entries = Object.keys(effective).length;
  if (entries > MAX_ENTRIES) throw invalid(`${name}: effective attributes must contain at most ${MAX_ENTRIES} entries (has ${entries})`);
  if (toEnv(effective).length > MAX_CHARS) throw invalid(`${name}: effective attributes must be at most ${MAX_CHARS} characters`);
  return effective;
}

export function effectiveAll(doc) {
  return Object.fromEntries(WORKLOADS.map(({ name }) => [name, effectiveAttributes(doc, name)]));
}

export function diffAttributes(before, after) {
  const added = {};
  const changed = {};
  const removed = [];
  for (const [key, value] of Object.entries(after)) {
    if (!(key in before)) added[key] = value;
    else if (before[key] !== value) changed[key] = [before[key], value];
  }
  for (const key of Object.keys(before)) if (!(key in after)) removed.push(key);
  return { added, changed, removed };
}

export const diffIsEmpty = diff => !Object.keys(diff.added).length && !Object.keys(diff.changed).length && !diff.removed.length;

export function summarizeDiff(diff) {
  return [
    ...Object.entries(diff.added).map(([key, value]) => `+${key}=${value}`),
    ...Object.entries(diff.changed).map(([key, [from, to]]) => `~${key}: ${from} -> ${to}`),
    ...diff.removed.map(key => `-${key}`),
  ].join("; ");
}

// live: { env, annotations, customProp }. Returns the change set and, when something differs, the strategic-merge patch.
export function planWorkload(workload, effective, live, oneagent) {
  const current = parseEnv(live.env);
  const diff = diffAttributes(current, effective);
  const wantedAnnotations = toAnnotations(effective);
  const currentAnnotations = Object.fromEntries(Object.entries(live.annotations || {})
    .filter(([key]) => key.startsWith(ANNOTATION_PREFIX) && !PRESERVED_ANNOTATIONS.has(key.slice(ANNOTATION_PREFIX.length))));
  const annotations = { ...wantedAnnotations };
  for (const key of Object.keys(currentAnnotations)) if (!(key in wantedAnnotations)) annotations[key] = null;
  const annotationDrift = Object.keys(annotations).some(key => annotations[key] === null || currentAnnotations[key] !== annotations[key]);
  const customProp = oneagent ? toCustomProp(effective) : null;
  const customPropDrift = oneagent && live.customProp !== customProp;
  const env = [{ name: "OTEL_RESOURCE_ATTRIBUTES", value: toEnv(effective) }];
  if (oneagent) env.push({ name: "DT_CUSTOM_PROP", value: customProp });
  const changed = !diffIsEmpty(diff) || annotationDrift || customPropDrift || toEnv(current) !== live.env;
  return {
    workload: workload.name,
    ns: workload.ns,
    kind: workload.kind,
    changed,
    diff,
    patch: changed ? { spec: { template: { metadata: { annotations }, spec: { containers: [{ name: workload.name, env }] } } } } : null,
  };
}
