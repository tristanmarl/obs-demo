import Fastify from "fastify";
import mysql from "mysql2/promise";
import { OpenFeature } from "@openfeature/server-sdk";
import { FlagdProvider } from "@openfeature/flagd-provider";
import { SpanEventHook } from "@openfeature/open-telemetry-hooks";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const dbUrl = process.env.RESULT_DB_URL || "";
let pool;

// Scenario flags come from flagd; evaluation errors fall back to false (stable behavior).
OpenFeature.setProvider(new FlagdProvider({ host: process.env.FLAGD_HOST || "flagd", port: 8013 }));
OpenFeature.addHooks(new SpanEventHook());
const flags = OpenFeature.getClient("result-api");

const getPool = () => (pool ??= mysql.createPool({ uri: dbUrl, connectionLimit: 4, connectTimeout: 5000 }));

async function persist({ job_id, status, message }) {
  const db = getPool();
  if (await flags.getBooleanValue("host-db-latency", false)) await db.query("SELECT SLEEP(2)");
  await db.execute("INSERT INTO results (job_id, status, message) VALUES (?, ?, ?)", [job_id ?? "", status ?? "", message ?? null]);
}

app.get("/healthz", async () => ({ ok: true, service: "result-api" }));
app.post("/result", async (request, reply) => {
  if (dbUrl) {
    try { await persist(request.body ?? {}); } catch (error) {
      request.log.error({ err: error }, "result persistence failed");
      return reply.code(503).send({ error: "result persistence failed" });
    }
  }
  return {
    resultId: `result-${Date.now()}`,
    jobId: request.body?.job_id,
    status: request.body?.status,
    message: request.body?.message,
  };
});

app.listen({ port, host: "0.0.0.0" });
