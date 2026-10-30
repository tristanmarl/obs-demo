// Scenario flags in flagd JSON format. The ConfigMap obs-demo-flags is the source of truth for scenario state.
export const FLAG_IDS = ["database-latency", "queue-backlog", "cache-errors", "grpc-deadline", "ai-latency", "allocation-pressure", "host-db-latency"];

// Scenario id -> flags it turns on. mesh-aborts is an Istio VirtualService fault, not a flag.
export const SCENARIO_FLAGS = {
  "database-latency": ["database-latency"],
  "queue-backlog": ["queue-backlog"],
  "cache-errors": ["cache-errors"],
  "mesh-aborts": [],
  "grpc-deadline": ["grpc-deadline"],
  "ai-latency": ["ai-latency"],
  "allocation-pressure": ["allocation-pressure"],
  "host-db-latency": ["host-db-latency"],
  "combined-failure": ["database-latency", "queue-backlog", "cache-errors"],
};

export function flagDocument(enabled = []) {
  const on = new Set(enabled);
  return {
    $schema: "https://flagd.dev/schema/v0/flags.json",
    flags: Object.fromEntries(FLAG_IDS.map(id => [id, { state: "ENABLED", variants: { on: true, off: false }, defaultVariant: on.has(id) ? "on" : "off" }])),
  };
}

// Returns { id: boolean } for every known flag; unknown or malformed documents read as all false.
export function readFlags(document) {
  const flags = document && typeof document === "object" ? document.flags : null;
  return Object.fromEntries(FLAG_IDS.map(id => {
    const flag = flags?.[id];
    return [id, flag?.state === "ENABLED" && flag.variants?.[flag.defaultVariant] === true];
  }));
}

// The scenario whose flag set exactly matches the enabled flags (plus the mesh fault); null when stable or mixed.
export function deriveScenario(flags, meshAborted) {
  const enabled = FLAG_IDS.filter(id => flags[id]);
  if (!enabled.length) return meshAborted ? "mesh-aborts" : null;
  if (meshAborted) return null;
  return Object.entries(SCENARIO_FLAGS).find(([, ids]) => ids.length === enabled.length && ids.every(id => flags[id]))?.[0] ?? null;
}
