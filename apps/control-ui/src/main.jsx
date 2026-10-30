import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Attributes } from "./Attributes.jsx";
import "./style.css";

const api = "/api";

// Platform apps live on the .apps host of the tenant (heuristic for the usual .live and sprint hostnames).
const appsBase = tenantUrl => (tenantUrl || "").replace(/\.live\./, ".apps.").replace(/\.sprint\.dynatracelabs/, ".sprint.apps.dynatracelabs");

function Details({ scenario, tenantUrl }) {
  const [copied, setCopied] = useState("");
  const base = appsBase(tenantUrl);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(text); } catch { setCopied(""); }
  }
  return (
    <details className="look-in">
      <summary>Details</summary>
      <dl><div><dt>Signal</dt><dd>{scenario.signal}</dd></div><div><dt>Target</dt><dd>{scenario.affectedService}</dd></div></dl>
      <p className="look-title">Look in Dynatrace</p>
      {base && <p className="look-links"><a href={`${base}/ui/apps/dynatrace.services`} target="_blank" rel="noreferrer">Services</a> · <a href={`${base}/ui/apps/dynatrace.distributedtracing`} target="_blank" rel="noreferrer">Distributed Tracing</a> (filter <code>{scenario.service}</code>)</p>}
      <ul>
        {(scenario.lookIn || []).map(item => <li key={item.dql}>
          <span>{item.text}</span>
          <span className="snippet"><code>{item.dql}</code><button type="button" className="secondary" aria-label={`Copy DQL: ${item.dql}`} onClick={() => copy(item.dql)}>{copied === item.dql ? "Copied" : "Copy"}</button></span>
        </li>)}
      </ul>
    </details>
  );
}

function ActionStatus({ action }) {
  return (
    <div className="action-status" role="status" aria-live="polite">
      {action && <>
        <p>{action.label} → {action.ok ? "" : "failed: "}{action.text}</p>
        <details>
          <summary>Show response</summary>
          <pre>{JSON.stringify(action.body, null, 2)}</pre>
        </details>
      </>}
    </div>
  );
}

function App() {
  const [status, setStatus] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [activeScenario, setActiveScenario] = useState(null);
  const [stateAvailable, setStateAvailable] = useState(true);
  const [controlsEnabled, setControlsEnabled] = useState(true);
  const [action, setAction] = useState(null);
  const [pendingScenario, setPendingScenario] = useState(null);

  async function refreshScenarios() {
    try {
      const response = await fetch(`${api}/scenarios`);
      if (!response.ok) throw new Error("scenario state unavailable");
      const body = await response.json();
      setScenarios(body.scenarios || []);
      setActiveScenario(body.activeScenario || null);
      setStateAvailable(body.stateAvailable !== false);
      setControlsEnabled(body.controlsEnabled !== false);
    } catch {
      setStateAvailable(false);
    }
  }

  useEffect(() => {
    fetch(`${api}/status`).then(response => {
      if (!response.ok) throw new Error("offline");
      return response.json();
    }).then(setStatus).catch(() => setStatus({ error: "offline" }));
    refreshScenarios();
  }, []);

  async function runScenario(label, path) {
    setPendingScenario(path);
    setAction({ label, ok: true, text: "running…", body: null });
    try {
      const response = await fetch(`${api}${path}`, { method: "POST" });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = { body: text }; }
      setAction({ label, ok: response.ok, text: `${response.status} ${response.ok ? "OK" : response.statusText || "error"}`.trim(), body });
      await refreshScenarios();
    } catch {
      setAction({ label, ok: false, text: "unavailable", body: null });
    } finally {
      setPendingScenario(null);
    }
  }

  const apiAvailable = status?.controlApi === "connected";
  const controls = controlsEnabled && apiAvailable;
  const known = scenarios.some(scenario => scenario.id === activeScenario);
  const activeLabel = scenarios.find(scenario => scenario.id === activeScenario)?.label || activeScenario;
  const needsReset = activeScenario && !known || !stateAvailable;
  const busy = pendingScenario !== null;
  return (
    <main>
      <header className="header">
        <h1>Observability Demo</h1>
        <p className="subtitle">Start a failure, then find it in Dynatrace.</p>
        <p className={`pill ${!apiAvailable ? "pill--offline" : ""}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {apiAvailable ? "Connected" : "Control API unavailable"}
          {activeScenario && <span className="active-tag">· {activeLabel} running</span>}
        </p>
        <p className="muted">Background traffic runs continuously via load-generator.</p>
      </header>

      {apiAvailable && !controlsEnabled && <p className="muted">Demo controls are disabled.</p>}

      {controls && <section className="section" aria-labelledby="scenarios-heading">
        <div className="section-heading">
          <h2 id="scenarios-heading">Failure scenarios</h2>
          {needsReset && <button type="button" className="secondary" onClick={() => runScenario("Reset", "/scenarios/reset")} disabled={busy}>Reset</button>}
        </div>
        <div className="scenario-grid">
          {scenarios.map(scenario => {
            const active = activeScenario === scenario.id;
            return (
              <article className={`scenario-card ${active ? "scenario-card--active" : ""}`} key={scenario.id}>
                <h3>{scenario.label}{active && <span className="running-tag">Running</span>}</h3>
                <p>{scenario.expectedSymptom}</p>
                <button type="button" className={active ? "secondary" : ""} aria-label={`${active ? "Stop" : "Start"} ${scenario.label}`} disabled={busy}
                  onClick={() => (active ? runScenario(`Stop ${scenario.label}`, "/scenarios/reset") : runScenario(`Start ${scenario.label}`, `/scenarios/${scenario.id}`))}>
                  {active ? "Stop" : "Start"}
                </button>
                <Details scenario={scenario} tenantUrl={status?.tenantUrl} />
              </article>
            );
          })}
        </div>
        <ActionStatus action={action} />
      </section>}

      {controls && <Attributes />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
