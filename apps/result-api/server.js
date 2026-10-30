import Fastify from "fastify";
import mysql from "mysql2/promise";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);
const dbUrl = process.env.RESULT_DB_URL || "";
let pool;

const getPool = () => (pool ??= mysql.createPool({ uri: dbUrl, connectionLimit: 4, connectTimeout: 5000 }));

async function persist({ job_id, status, message }) {
  const db = getPool();
  if (process.env.SCENARIO_MODE === "host-db-latency") await db.query("SELECT SLEEP(2)");
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
