import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FLAG_IDS, SCENARIO_FLAGS, deriveScenario, flagDocument, readFlags } from "./flags.js";

test("every scenario maps to known flags and reads back as itself", () => {
  for (const [scenario, ids] of Object.entries(SCENARIO_FLAGS)) {
    for (const id of ids) assert.ok(FLAG_IDS.includes(id));
    const flags = readFlags(flagDocument(ids));
    assert.equal(deriveScenario(flags, scenario === "mesh-aborts"), scenario);
  }
});

test("stable document has every flag off and derives no scenario", () => {
  const flags = readFlags(flagDocument());
  assert.ok(FLAG_IDS.every(id => flags[id] === false));
  assert.equal(deriveScenario(flags, false), null);
});

test("mixed or partial states are not reported as a scenario", () => {
  assert.equal(deriveScenario(readFlags(flagDocument(["database-latency", "queue-backlog"])), false), null);
  assert.equal(deriveScenario(readFlags(flagDocument(["cache-errors"])), true), null);
});

test("flag document is flagd boolean format with default off", () => {
  const document = flagDocument(["ai-latency"]);
  assert.equal(document.flags["ai-latency"].defaultVariant, "on");
  assert.equal(document.flags["ai-latency"].variants.on, true);
  assert.equal(document.flags["database-latency"].defaultVariant, "off");
  assert.deepEqual(Object.keys(document.flags), FLAG_IDS);
});

test("malformed or disabled flags read as false", () => {
  assert.ok(Object.values(readFlags(null)).every(value => value === false));
  const document = flagDocument(["ai-latency"]);
  document.flags["ai-latency"].state = "DISABLED";
  assert.equal(readFlags(document)["ai-latency"], false);
});

test("seed file config/flags.json is the stable document", () => {
  const seed = JSON.parse(readFileSync(new URL("../../config/flags.json", import.meta.url), "utf8"));
  assert.deepEqual(seed, flagDocument());
});
