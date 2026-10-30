// Scenario flags in flagd JSON format. The ConfigMap obs-demo-flags is the source of truth for scenario state.
// Scenario id -> flags it turns on. Exactly one scenario is active at a time.
export const SCENARIO_FLAGS = {
  "database-latency": ["database-latency"],
  "queue-backlog": ["queue-backlog"],
  "error-spike": ["error-spike"],
  "memory-pressure": ["memory-pressure"],
};

export const FLAG_IDS = Object.keys(SCENARIO_FLAGS);

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

// The scenario whose flag is the single enabled one; null when stable or when several flags are on.
export function deriveScenario(flags) {
  const enabled = FLAG_IDS.filter(id => flags[id]);
  return enabled.length === 1 ? enabled[0] : null;
}
