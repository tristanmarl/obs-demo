import Fastify from "fastify";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);

app.get("/healthz", async () => ({ ok: true, service: "result-api" }));
app.post("/result", async request => ({
  resultId: `result-${Date.now()}`,
  jobId: request.body?.job_id,
  status: request.body?.status,
  message: request.body?.message,
}));

app.listen({ port, host: "0.0.0.0" });
