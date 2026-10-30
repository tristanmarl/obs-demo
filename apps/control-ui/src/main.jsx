import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Attributes } from "./Attributes.jsx";
import "./style.css";

const api = "/api";

// Platform apps live on the .apps host of the tenant (heuristic for the usual .live and sprint hostnames).
const appsBase = tenantUrl => (tenantUrl || "").replace(/\.live\./, ".apps.").replace(/\.sprint\.dynatracelabs/, ".sprint.apps.dynatracelabs");

function LookIn({ scenario, tenantUrl }) {
  const [copied, setCopied] = useState("");
  const base = appsBase(tenantUrl);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(text); } catch { setCopied(""); }
  }
  if (!scenario.lookIn?.length) return null;
  return (
    <details className="look-in">
      <summary>Look in Dynatrace</summary>
      {base && <p className="look-links"><a href={`${base}/ui/apps/dynatrace.services`} target="_blank" rel="noreferrer">Services</a> · <a href={`${base}/ui/apps/dynatrace.distributedtracing`} target="_blank" rel="noreferrer">Distributed Tracing</a> (filter <code>{scenario.service}</code>)</p>}
      <ul>
        {scenario.lookIn.map(item => <li key={item.dql}>
          <span>{item.text}</span>
          <span className="snippet"><code>{item.dql}</code><button type="button" className="secondary" aria-label={`Copy DQL: ${item.dql}`} onClick={() => copy(item.dql)}>{copied === item.dql ? "Copied" : "Copy"}</button></span>
        </li>)}
      </ul>
    </details>
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [result, setResult] = useState(null);
  const [operation, setOperation] = useState("");
  const [pendingScenario, setPendingScenario] = useState(null);
  const [job, setJob] = useState({ name: "demo-job", workUnits: 10 });

  async function callApi(path, options = {}) {
    const response = await fetch(`${api}${path}`, options);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { body: text }; }
    setResult({ path, status: response.status, body });
    return { response, body };
  }

  async function refreshScenarios() {
    try {
      const response = await fetch(`${api}/scenarios`);
      if (!response.ok) throw new Error("scenario state unavailable");
      const body = await response.json();
      setScenarios(body.scenarios || []);
      setActiveScenario(body.activeScenario || null);
      setControlsEnabled(body.controlsEnabled !== false);
    } catch {
      setOperation("Scenario state unavailable");
    }
  }

  useEffect(() => {
    fetch(`${api}/status`).then(response => {
      if (!response.ok) throw new Error("offline");
      return response.json();
    }).then(setStatus).catch(() => setStatus({ error: "offline" }));
    refreshScenarios();
  }, []);

  async function runAction(label, path, options) {
    setOperation(`${label} running…`);
    try {
      const { response } = await callApi(path, options);
      setOperation(`${label}: HTTP ${response.status}`);
    } catch {
      setOperation(`${label}: unavailable`);
    }
  }

  async function submitJob(event) {
    event.preventDefault();
    await runAction("Submit asynchronous job", "/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(job),
    });
  }

  async function applyScenario(id) {
    setPendingScenario(id);
    setOperation(`Applying ${id}…`);
    try {
      const { response } = await callApi(`/scenarios/${id}`, { method: "POST" });
      await refreshScenarios();
      setOperation(response.ok ? `${id} active` : `Scenario failed: HTTP ${response.status}`);
    } catch {
      setOperation("Scenario operation unavailable");
    } finally {
      setPendingScenario(null);
    }
  }

  async function resetScenarios() {
    setPendingScenario("reset");
    setOperation("Resetting scenarios…");
    try {
      const { response } = await callApi("/scenarios/reset", { method: "POST" });
      await refreshScenarios();
      setOperation(response.ok ? "Scenarios stable" : `Reset failed: HTTP ${response.status}`);
    } catch {
      setOperation("Reset unavailable");
    } finally {
      setPendingScenario(null);
    }
  }

  const apiAvailable = status?.controlApi === "connected";
  const controls = controlsEnabled && apiAvailable;
  return (
    <main>
      <header className="header">
        <p className="eyebrow">Observability Demo</p>
        <h1>Distributed systems observability lab</h1>
        <p className="subtitle">Generate connected HTTP, PostgreSQL, Redis, ActiveMQ, gRPC, FaaS, AI, and memory signals.</p>
        <div className={`status-bar ${!apiAvailable ? "status-bar--offline" : ""}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {apiAvailable ? "Control API connected" : "Control API unavailable"}
          {activeScenario && <span className="active-tag">Scenario active: {activeScenario}</span>}
        </div>
      </header>

      <section className="section">
        <h2>Manual requests (optional)</h2>
        <p>Background traffic runs automatically via <code>load-generator</code>. Use these controls for one immediate trace or a custom job.</p>
        <form className="job-form" onSubmit={submitJob}>
          <label htmlFor="job-name">Job name<input id="job-name" value={job.name} onChange={event => setJob({ ...job, name: event.target.value })} /></label>
          <label htmlFor="work-units">Work units<input id="work-units" type="number" min="1" max="100" value={job.workUnits} onChange={event => setJob({ ...job, workUnits: Number(event.target.value) })} /></label>
          <button type="submit" disabled={!apiAvailable}>Submit asynchronous job</button>
        </form>
        <div className="action-row">
          <button onClick={() => runAction("Query PostgreSQL", "/catalog")} disabled={!apiAvailable}>Query PostgreSQL</button>
          <button onClick={() => runAction("Call Redis", "/cache", { method: "POST" })} disabled={!apiAvailable}>Call Redis</button>
          <button onClick={() => runAction("Call AI service", "/analysis")} disabled={!apiAvailable}>Call AI service</button>
        </div>
      </section>

      {controls && <section className="section">
        <div className="section-heading"><div><h2>Failure scenarios</h2><p>One deterministic condition at a time; the backend is the source of truth after reload.</p></div><button className="secondary" onClick={resetScenarios} disabled={pendingScenario !== null}>Reset all</button></div>
        <div className="scenario-grid">
          {scenarios.map(scenario => <article className={`scenario-card ${activeScenario === scenario.id ? "scenario-card--active" : ""}`} key={scenario.id}>
            <div className="scenario-state">{activeScenario === scenario.id ? "Active" : "Stable"}</div>
            <h3>{scenario.label}</h3>
            <p>{scenario.expectedSymptom}</p>
            <dl><div><dt>Signal</dt><dd>{scenario.signal}</dd></div><div><dt>Target</dt><dd>{scenario.affectedService}</dd></div></dl>
            <button onClick={() => applyScenario(scenario.id)} disabled={pendingScenario !== null}>{pendingScenario === scenario.id ? "Applying…" : "Apply scenario"}</button>
            <LookIn scenario={scenario} tenantUrl={status?.tenantUrl} />
          </article>)}
        </div>
      </section>}

      {controls && <Attributes setOperation={setOperation} />}

      <p className="operation" aria-live="polite">{operation}</p>
      {result && <section className="result section"><h2>Live API output</h2><p>{result.path} · HTTP {result.status}</p><pre>{JSON.stringify(result.body, null, 2)}</pre></section>}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
