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
  const [release, setRelease] = useState({ service: "checkout-service", version: "1.4.2", environment: "staging" });

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
      const body = await response.json();
      setScenarios(body.scenarios || []);
      setActiveScenario(body.activeScenario || null);
      setControlsEnabled(body.controlsEnabled !== false);
    } catch {
      setOperation("Scenario state unavailable");
    }
  }

  useEffect(() => {
    fetch(`${api}/status`).then(response => response.json()).then(setStatus).catch(() => setStatus({ error: "offline" }));
    fetch(`${api}/resource-attrs`).then(response => response.json()).then(body => setAttrs(body.attrs || "")).catch(() => {});
    refreshScenarios();
  }, []);

  async function runAction(label, path, options) {
    setOperation(`${label} running…`);
    try {
      const { response } = await callApi(path, options);
      setOperation(`${label}: ${response.status}`);
    } catch {
      setOperation(`${label}: unavailable`);
    }
  }

  async function createRelease(event) {
    event.preventDefault();
    await runAction("Release request", "/releases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(release),
    });
  }

  async function applyScenario(id) {
    setPendingScenario(id);
    setOperation(`Applying ${id}…`);
    try {
      const { response } = await callApi(`/scenarios/${id}`, { method: "POST" });
      await refreshScenarios();
      setOperation(response.ok ? `${id} active` : `Scenario failed: ${response.status}`);
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
      setOperation(response.ok ? "Scenarios stable" : `Reset failed: ${response.status}`);
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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attrs }),
      });
      setOperation(response.ok ? "Telemetry context applied" : `Telemetry context rejected: ${response.status}`);
    } catch {
      setOperation("Telemetry context unavailable");
    } finally {
      setAttrsPending(false);
    }
  }

  const apiAvailable = status?.error !== "offline";
  const controls = controlsEnabled && apiAvailable;
  return (
    <main>
      <header className="header">
        <p className="eyebrow">NebulaTrace</p>
        <h1>Software delivery observability lab</h1>
        <p className="subtitle">Trace a release from the platform facade through PostgreSQL, ActiveMQ, gRPC, and audit.</p>
        <div className={`status-bar ${status?.error ? "status-bar--offline" : ""}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {status?.error ? "Control API unavailable" : "Control API connected"}
          {activeScenario && <span className="active-tag">Scenario active: {activeScenario}</span>}
        </div>
      </header>

      <section className="section">
        <h2>Run the platform</h2>
        <form className="release-form" onSubmit={createRelease}>
          <label>Service<input value={release.service} onChange={event => setRelease({ ...release, service: event.target.value })} /></label>
          <label>Version<input value={release.version} onChange={event => setRelease({ ...release, version: event.target.value })} /></label>
          <label>Environment<select value={release.environment} onChange={event => setRelease({ ...release, environment: event.target.value })}>
            {['development', 'test', 'staging', 'production'].map(value => <option key={value}>{value}</option>)}
          </select></label>
          <button type="submit" disabled={!apiAvailable}>Create release</button>
        </form>
        <div className="action-row">
          <button onClick={() => runAction("Artifact catalog", "/artifacts")} disabled={!apiAvailable}>Artifact catalog</button>
          <button onClick={() => runAction("Quota check", "/quota")} disabled={!apiAvailable}>Quota check</button>
          <button onClick={() => runAction("Incident recommendation", "/incidents/recommendation")} disabled={!apiAvailable}>Incident recommendation</button>
        </div>
      </section>

      {controls && <section className="section">
        <div className="section-heading"><div><h2>Incident scenarios</h2><p>Apply one deterministic condition at a time; reload keeps the backend-derived state.</p></div><button className="secondary" onClick={resetScenarios} disabled={pendingScenario !== null}>Reset all</button></div>
        <div className="scenario-grid">
          {scenarios.map(scenario => <article className={`scenario-card ${activeScenario === scenario.id ? "scenario-card--active" : ""}`} key={scenario.id}>
            <div className="scenario-state">{activeScenario === scenario.id ? "Active" : "Stable"}</div>
            <h3>{scenario.label}</h3>
            <p>{scenario.expectedSymptom}</p>
            <dl><div><dt>Signal</dt><dd>{scenario.signal}</dd></div><div><dt>Affected service</dt><dd>{scenario.affectedService}</dd></div></dl>
            <button onClick={() => applyScenario(scenario.id)} disabled={pendingScenario !== null}>{pendingScenario === scenario.id ? "Applying…" : "Apply scenario"}</button>
          </article>)}
        </div>
      </section>}

      {controls && <section className="section">
        <h2>Demo telemetry context</h2>
        <p>Comma-separated <code>key=value</code> attributes. Applying context restarts application and data workloads.</p>
        <div className="context-row"><label className="sr-only" htmlFor="attrs">Telemetry resource attributes</label><input id="attrs" value={attrs} onChange={event => setAttrs(event.target.value)} placeholder="team=platform,release.channel=canary" disabled={attrsPending} /><button onClick={applyAttrs} disabled={attrsPending || !attrs.trim()}>{attrsPending ? "Applying…" : "Apply & restart"}</button></div>
      </section>}

      <p className="operation" aria-live="polite">{operation}</p>
      {result && <section className="result section"><h2>Live API output</h2><p>{result.path} · HTTP {result.status}</p><pre>{JSON.stringify(result.body, null, 2)}</pre></section>}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
