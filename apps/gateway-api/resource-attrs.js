const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;
const FORBIDDEN = new Set(["service.name", "service.instance.id"]);

export function parseResourceAttrs(input) {
  const invalid = message => Object.assign(new Error(message), { code: "INVALID_RESOURCE_ATTRIBUTES" });
  if (typeof input !== "string" || !input.trim()) throw invalid("attrs must be a non-empty comma-separated key=value string");
  if (input.length > 2048) throw invalid("attrs must be at most 2048 characters");
  const entries = input.split(",").map(item => item.trim());
  if (entries.some(entry => !entry)) throw invalid("attrs cannot contain empty entries");
  if (entries.length > 32) throw invalid("attrs must contain at most 32 entries");
  const seen = new Set();
  const normalized = entries.map(entry => {
    const separator = entry.indexOf("=");
    if (separator < 1) throw invalid(`invalid entry '${entry}'; use key=value`);
    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!KEY.test(key)) throw invalid(`invalid key '${key}'; use letters, numbers, _, -, and .`);
    if (!value) throw invalid(`value for '${key}' must not be empty`);
    if (FORBIDDEN.has(key)) throw invalid(`${key} is workload-specific and cannot be changed`);
    if (seen.has(key)) throw invalid(`duplicate key '${key}'`);
    seen.add(key);
    return `${key}=${value}`;
  });
  return { attrs: normalized.join(","), entries: normalized };
}
