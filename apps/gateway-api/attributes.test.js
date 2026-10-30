import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKLOADS, diffAttributes, effectiveAll, effectiveAttributes, parseEnv, planWorkload, summarizeDiff,
  toAnnotations, toCustomProp, toEnv, validateDocument,
} from "./attributes.js";

const base = () => ({
  global: { "deployment.environment.name": "demo", "service.namespace": "obs-demo" },
  teams: { platform: { "dt.owner": "platform", tier: "team" } },
  workloads: { "catalog-api": { team: "platform", attributes: { tier: "core" } } },
  presets: { security: { "dt.security_context": "restricted", tier: "preset" } },
  activePreset: "",
});

test("precedence is global, preset, team, workload", () => {
  const doc = validateDocument({ ...base(), activePreset: "security" });
  assert.deepEqual(effectiveAttributes(doc, "catalog-api"), {
    "deployment.environment.name": "demo", "service.namespace": "obs-demo",
    "dt.security_context": "restricted", "dt.owner": "platform", tier: "core",
  });
  assert.equal(effectiveAttributes(doc, "redis").tier, "preset");
  assert.equal(effectiveAttributes(validateDocument(base()), "redis").tier, undefined);
});

test("covers app and data workloads", () => {
  assert.equal(Object.keys(effectiveAll(validateDocument(base()))).length, WORKLOADS.length);
  for (const name of ["redis", "postgres", "activemq", "google-cloud-function-trigger"]) assert.ok(WORKLOADS.some(item => item.name === name));
});

test("accepts YAML text", () => {
  const doc = validateDocument("global:\n  a.b: 1\nworkloads:\n  redis: { attributes: { x: y } }\n");
  assert.equal(doc.global["a.b"], "1");
  assert.equal(doc.workloads.redis.attributes.x, "y");
});

test("rejects forbidden, malformed, empty and oversized attributes at every layer", () => {
  for (const layer of ["global", "teams", "presets"]) {
    for (const bad of [{ "service.name": "x" }, { "service.instance.id": "x" }, { "bad key": "x" }, { "1a": "x" }, { k: "" }, { k: "a,b" }, { k: { n: 1 } }]) {
      const doc = base();
      if (layer === "global") doc.global = bad; else doc[layer].platform ? (doc[layer].platform = bad) : (doc[layer].security = bad);
      assert.throws(() => validateDocument(doc), /./, `${layer} ${JSON.stringify(bad)}`);
    }
  }
  const workload = base();
  workload.workloads["catalog-api"].attributes = { "service.name": "x" };
  assert.throws(() => validateDocument(workload), /service.name/);
  const overlong = base();
  overlong.global = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`key${index}`, "v"]));
  assert.throws(() => validateDocument(overlong), /at most 32/);
  const chars = base();
  chars.global = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`key${index}`, "v".repeat(100)]));
  assert.throws(() => validateDocument(chars), /2048/);
});

test("rejects unknown workloads, teams, presets and keys", () => {
  assert.throws(() => validateDocument({ ...base(), workloads: { nope: {} } }), /unknown workload/);
  assert.throws(() => validateDocument({ ...base(), workloads: { redis: { team: "ghost" } } }), /unknown team/);
  assert.throws(() => validateDocument({ ...base(), activePreset: "ghost" }), /unknown preset/);
  assert.throws(() => validateDocument({ ...base(), extra: {} }), /unknown top-level/);
});

test("effective set limits apply after merging layers", () => {
  const doc = base();
  doc.global = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`g${index}`, "v"]));
  doc.teams.platform = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`t${index}`, "v"]));
  assert.throws(() => validateDocument(doc), /catalog-api.*at most 32/);
});

test("diff reports added, changed and removed keys", () => {
  const diff = diffAttributes({ a: "1", b: "2", c: "3" }, { a: "1", b: "9", d: "4" });
  assert.deepEqual(diff, { added: { d: "4" }, changed: { b: ["2", "9"] }, removed: ["c"] });
  assert.equal(summarizeDiff(diff), "+d=4; ~b: 2 -> 9; -c");
});

test("serializers", () => {
  const attrs = { b: "two words", a: "1" };
  assert.equal(toEnv(attrs), "a=1,b=two words");
  assert.deepEqual(parseEnv("a=1,b=x=y"), { a: "1", b: "x=y" });
  assert.equal(toCustomProp(attrs), "a=1 b=two_words");
  assert.deepEqual(toAnnotations({ a: "1" }), { "metadata.dynatrace.com/a": "1" });
});

test("plan patches only changed workloads and removes stale annotations but keeps the service annotation", () => {
  const workload = WORKLOADS.find(item => item.name === "catalog-api");
  const effective = { a: "1", b: "2" };
  const live = { env: "a=1,b=2", customProp: "a=1 b=2", annotations: { "metadata.dynatrace.com/service": "catalog-api", "metadata.dynatrace.com/a": "1", "metadata.dynatrace.com/b": "2" } };
  assert.equal(planWorkload(workload, effective, live, true).changed, false);
  const next = planWorkload(workload, { a: "1", c: "3" }, live, true);
  assert.equal(next.changed, true);
  assert.deepEqual(next.diff, { added: { c: "3" }, changed: {}, removed: ["b"] });
  const annotations = next.patch.spec.template.metadata.annotations;
  assert.equal(annotations["metadata.dynatrace.com/b"], null);
  assert.equal(annotations["metadata.dynatrace.com/c"], "3");
  assert.ok(!("metadata.dynatrace.com/service" in annotations));
  const env = next.patch.spec.template.spec.containers[0].env;
  assert.deepEqual(env.map(item => item.name), ["OTEL_RESOURCE_ATTRIBUTES", "DT_CUSTOM_PROP"]);
  assert.equal(planWorkload(workload, { a: "1", c: "3" }, live, false).patch.spec.template.spec.containers[0].env.length, 1);
});

test("annotation drift alone marks a workload changed", () => {
  const workload = WORKLOADS.find(item => item.name === "redis");
  const plan = planWorkload(workload, { a: "1" }, { env: "a=1", annotations: {} }, false);
  assert.equal(plan.changed, true);
  assert.equal(plan.patch.spec.template.metadata.annotations["metadata.dynatrace.com/a"], "1");
});
