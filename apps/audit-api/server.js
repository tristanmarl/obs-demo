import Fastify from "fastify";

const app = Fastify({ logger: true });
const port = Number(process.env.PORT || 8080);

app.get("/healthz", async () => ({ ok: true, service: "audit-api" }));
app.post("/audit", async request => ({
  auditId: `audit-${Date.now()}`,
  releaseId: request.body?.release_id,
  status: "recorded",
}));

app.listen({ port, host: "0.0.0.0" });
