// CLI entry point: node apply-attributes.js [--preview]. Same code path as POST /api/attributes/{preview,apply}.
import k8s from "@kubernetes/client-node";
import { applyDocument, describePlan, loadDocument, planDocument } from "./attributes-store.js";
import { summarizeDiff } from "./attributes.js";

const kc = new k8s.KubeConfig();
try { kc.loadFromCluster(); } catch { kc.loadFromDefault(); }
const apps = kc.makeApiClient(k8s.AppsV1Api);
const core = kc.makeApiClient(k8s.CoreV1Api);

try {
  const doc = await loadDocument(core);
  const result = process.argv.includes("--preview")
    ? { plan: describePlan(await planDocument(apps, doc)), restarting: null }
    : await applyDocument(apps, core, doc);
  for (const entry of result.plan) {
    const status = entry.error ? entry.error : entry.changed ? summarizeDiff(entry.diff) || "annotation sync" : "unchanged";
    console.log(`${entry.workload.padEnd(30)} ${entry.changed ? "CHANGE" : "  -   "}  ${status}`);
  }
  const count = result.plan.filter(entry => entry.changed).length;
  console.log(result.restarting ? `Applied; restarting ${count} workloads.` : `Preview: ${count} workloads would restart.`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
