import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import YAML from "yaml";

const path = new URL("../../deploy/dist/obs-demo.yaml", import.meta.url);
const docs = existsSync(path) ? YAML.parseAllDocuments(readFileSync(path, "utf8")) : [];

test("dist manifest is valid YAML and every workload has resource requests", { skip: !docs.length }, () => {
  for (const doc of docs) assert.deepEqual(doc.errors, []);
  const workloads = docs.map(doc => doc.toJS()).filter(item => ["Deployment", "StatefulSet"].includes(item?.kind));
  assert.ok(workloads.length >= 19);
  for (const item of workloads) {
    for (const container of item.spec.template.spec.containers) {
      assert.ok(container.resources?.requests?.memory, `${item.metadata.name} needs resource requests`);
    }
  }
});

test("only /api is routed to gateway-api through the ingress (never /internal)", { skip: !docs.length }, () => {
  const virtualService = docs.map(doc => doc.toJS()).find(item => item?.kind === "VirtualService" && item.metadata.name === "control-ui");
  const prefixes = virtualService.spec.http.flatMap(route => (route.match || []).map(match => match.uri.prefix));
  assert.deepEqual(prefixes, ["/api"]);
});
