import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const api = "/api";

function App() {
  const [status, setStatus] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [attrs, setAttrs] = useState("");
  const [result, setResult] = useState(null);
  const [operation, setOperation] = useState("");
  const [pendingScenario, setPendingScenario] = useState(null);
  const [attrsPending, setAttrsPending] = useState(false);
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
    fetch(`${api}/resource-attrs`).then(response => response.json()).then(body => setAttrs(body.attrs || "")).catch(() => {});
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

  async function applyAttrs() {
    setAttrsPending(true);
    setOperation("Applying telemetry context and restarting workloads…");
    try {
      const { response } = await callApi("/resource-attrs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attrs }),
      });
      setOperation(response.ok ? "Telemetry context applied" : `Telemetry context rejected: HTTP ${response.status}`);
    } catch {
      setOperation("Telemetry context unavailable");
    } finally {
      setAttrsPending(false);
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
          </article>)}
        </div>
      </section>}

      {controls && <section className="section">
        <h2>Demo telemetry context</h2>
        <p>Comma-separated <code>key=value</code> attributes. Applying context restarts application and data workloads; disable controls before exposing ingress publicly.</p>
        <div className="context-row"><label className="sr-only" htmlFor="attrs">Telemetry resource attributes</label><input id="attrs" value={attrs} onChange={event => setAttrs(event.target.value)} placeholder="team=observability,region=demo" disabled={attrsPending} /><button onClick={applyAttrs} disabled={attrsPending || !attrs.trim()}>{attrsPending ? "Applying…" : "Apply & restart"}</button></div>
      </section>}

      <p className="operation" aria-live="polite">{operation}</p>
      {result && <section className="result section"><h2>Live API output</h2><p>{result.path} · HTTP {result.status}</p><pre>{JSON.stringify(result.body, null, 2)}</pre></section>}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
