import React, { useEffect, useState } from "react";

const api = "/api";
const toRows = layer => Object.entries(layer || {}).map(([key, value]) => ({ key, value: String(value) }));
const fromRows = rows => Object.fromEntries(rows.filter(row => row.key.trim() || row.value.trim()).map(row => [row.key.trim(), row.value]));
const dql = key => (/^[A-Za-z0-9_.]+$/.test(key) ? key : `\`${key}\``);

function toEditor(doc) {
  return {
    activePreset: doc.activePreset || "",
    global: toRows(doc.global),
    presets: Object.fromEntries(Object.entries(doc.presets).map(([name, layer]) => [name, toRows(layer)])),
    teams: Object.fromEntries(Object.entries(doc.teams).map(([name, layer]) => [name, toRows(layer)])),
    workloads: Object.fromEntries(Object.entries(doc.workloads).map(([name, entry]) => [name, { team: entry.team || "", attrs: toRows(entry.attributes).map(row => `${row.key}=${row.value}`).join(", ") }])),
  };
}

function toDocument(editor) {
  const mapRows = layers => Object.fromEntries(Object.entries(layers).map(([name, rows]) => [name, fromRows(rows)]));
  const workloads = {};
  for (const [name, entry] of Object.entries(editor.workloads)) {
    const attributes = {};
    for (const part of entry.attrs.split(",").map(item => item.trim()).filter(Boolean)) {
      const separator = part.indexOf("=");
      attributes[separator < 0 ? part : part.slice(0, separator).trim()] = separator < 0 ? "" : part.slice(separator + 1).trim();
    }
    workloads[name] = { team: entry.team, attributes };
  }
  return { activePreset: editor.activePreset, global: fromRows(editor.global), presets: mapRows(editor.presets), teams: mapRows(editor.teams), workloads };
}

function Rows({ id, label, rows, onChange, disabled }) {
  const update = (index, patch) => onChange(rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  return (
    <fieldset className="kv" disabled={disabled}>
      <legend>{label}</legend>
      {rows.map((row, index) => (
        <div className="kv-row" key={index}>
          <input aria-label={`${label} attribute key ${index + 1}`} value={row.key} onChange={event => update(index, { key: event.target.value })} placeholder="key" />
          <input aria-label={`${label} attribute value ${index + 1}`} value={row.value} onChange={event => update(index, { value: event.target.value })} placeholder="value" />
          <button type="button" className="secondary" aria-label={`Remove ${row.key || "empty"} from ${label}`} onClick={() => onChange(rows.filter((_, position) => position !== index))}>Remove</button>
        </div>
      ))}
      <button type="button" className="secondary" id={`${id}-add`} onClick={() => onChange([...rows, { key: "", value: "" }])}>Add attribute</button>
    </fieldset>
  );
}

function Queries({ effective }) {
  const [copied, setCopied] = useState("");
  const seen = {};
  for (const attrs of Object.values(effective || {})) for (const [key, value] of Object.entries(attrs)) if (!(key in seen)) seen[key] = value;
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(text); } catch { setCopied(""); }
  }
  const keys = Object.keys(seen).sort();
  if (!keys.length) return null;
  return (
    <details className="queries">
      <summary>Where do these attributes show up? ({keys.length} keys, DQL)</summary>
      <p>Starting points; confirm in your tenant which signals carry each attribute.</p>
      {keys.map(key => {
        const field = dql(key);
        const snippets = [
          `fetch spans | filter ${field} == "${seen[key]}" | limit 20`,
          `fetch logs | filter ${field} == "${seen[key]}" | limit 20`,
          `timeseries sum(dt.service.request.count), by: {${field}}`,
        ];
        return (
          <div className="query-key" key={key}>
            <h4><code>{key}</code></h4>
            {snippets.map(snippet => (
              <div className="snippet" key={snippet}>
                <code>{snippet}</code>
                <button type="button" className="secondary" aria-label={`Copy DQL for ${key}: ${snippet}`} onClick={() => copy(snippet)}>{copied === snippet ? "Copied" : "Copy"}</button>
              </div>
            ))}
          </div>
        );
      })}
    </details>
  );
}

export function Attributes() {
  const [workloads, setWorkloads] = useState([]);
  const [editor, setEditor] = useState(null);
  const [effective, setEffective] = useState({});
  const [plan, setPlan] = useState(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [action, setAction] = useState(null);
  const [newTeam, setNewTeam] = useState("");

  useEffect(() => {
    fetch(`${api}/attributes`).then(async response => {
      const body = await response.json().catch(() => ({}));
      if (response.status === 503) { setUnavailable(true); return; }
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setWorkloads(body.workloads);
      setEditor(toEditor(body.document));
      setEffective(body.effective);
    }).catch(error => setProblem(`Attribute store unavailable: ${error.message}`));
  }, []);

  async function post(path, label) {
    setPending(true);
    setProblem("");
    setAction({ label, ok: true, text: "running…" });
    try {
      const response = await fetch(`${api}/attributes/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toDocument(editor)) });
      const body = await response.json();
      if (!response.ok) {
        setProblem(body.error || `HTTP ${response.status}`);
        setAction({ label, ok: false, text: `${response.status} rejected`, body });
        return;
      }
      setPlan(body);
      setAction({ label, ok: true, text: `${response.status} OK`, body });
      if (path === "apply") {
        const fresh = await (await fetch(`${api}/attributes`)).json();
        setEffective(fresh.effective);
      }
    } catch {
      setAction({ label, ok: false, text: "unavailable" });
    } finally {
      setPending(false);
    }
  }

  if (unavailable) return <section className="section"><h2>Resource attributes</h2><p className="muted">Needs Kubernetes — available when deployed to the cluster.</p></section>;
  if (!editor) return <section className="section"><h2>Resource attributes</h2><p className={problem ? "problem" : "muted"} role="status">{problem || "Loading…"}</p></section>;
  const set = patch => { setEditor({ ...editor, ...patch }); setPlan(null); };
  const teams = Object.keys(editor.teams);
  const presets = Object.keys(editor.presets);
  const preset = editor.activePreset;
  const changed = plan ? plan.plan.filter(entry => entry.changed || entry.error) : [];

  return (
    <section className="section" aria-labelledby="attrs-heading">
      <h2 id="attrs-heading">Resource attributes</h2>
      <p className="muted">Tags added to telemetry from every workload. Preview shows what restarts; Apply restarts only workloads whose attributes changed.</p>

      <Rows id="global" label="Attributes for all workloads" rows={editor.global} onChange={rows => set({ global: rows })} disabled={pending} />

      <details className="advanced">
        <summary>Advanced: presets, teams, per-workload</summary>
        <p className="muted">Precedence: global, then the active preset, then team, then workload. Edits are stored in the cluster; <code>make attributes</code> overwrites them from <code>config/attributes.yaml</code>.</p>
        <div className="kv-block">
          <label htmlFor="preset">Active preset
            <select id="preset" value={preset} onChange={event => set({ activePreset: event.target.value })} disabled={pending}>
              <option value="">None</option>
              {presets.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          {preset && <Rows id="preset" label={`Preset ${preset}`} rows={editor.presets[preset]} onChange={rows => set({ presets: { ...editor.presets, [preset]: rows } })} disabled={pending} />}
        </div>

        {teams.map(team => <Rows key={team} id={`team-${team}`} label={`Team ${team}`} rows={editor.teams[team]} onChange={rows => set({ teams: { ...editor.teams, [team]: rows } })} disabled={pending} />)}
        <div className="context-row">
          <label className="sr-only" htmlFor="new-team">New team name</label>
          <input id="new-team" value={newTeam} onChange={event => setNewTeam(event.target.value)} placeholder="new-team-name" disabled={pending} />
          <button type="button" className="secondary" disabled={pending || !newTeam.trim() || editor.teams[newTeam.trim()]} onClick={() => { set({ teams: { ...editor.teams, [newTeam.trim()]: [] } }); setNewTeam(""); }}>Add team</button>
        </div>

        <div className="table-wrap">
          <table className="workload-table">
            <caption>Workloads</caption>
            <thead><tr><th scope="col">Workload</th><th scope="col">Team</th><th scope="col">Extra attributes (key=value, comma separated)</th></tr></thead>
            <tbody>
              {workloads.map(({ name }) => {
                const entry = editor.workloads[name] || { team: "", attrs: "" };
                const update = patch => set({ workloads: { ...editor.workloads, [name]: { ...entry, ...patch } } });
                return (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td><select aria-label={`Team for ${name}`} value={entry.team} onChange={event => update({ team: event.target.value })} disabled={pending}><option value="">None</option>{teams.map(team => <option key={team} value={team}>{team}</option>)}</select></td>
                    <td><input aria-label={`Extra attributes for ${name}`} value={entry.attrs} onChange={event => update({ attrs: event.target.value })} placeholder="tier=core" disabled={pending} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>

      <div className="action-row">
        <button type="button" className="secondary" onClick={() => post("preview", "Preview attributes")} disabled={pending}>Preview</button>
        <button type="button" onClick={() => post("apply", "Apply attributes")} disabled={pending}>{pending ? "Working…" : "Apply"}</button>
      </div>
      {problem && <p className="problem" role="alert">{problem}</p>}

      {plan && <div className="plan">
        <p><strong>{plan.restarting.length} {plan.restarting.length === 1 ? "workload" : "workloads"} will restart</strong></p>
        {changed.length > 0 && <details>
          <summary>Show changes</summary>
          <ul>
            {changed.map(entry => (
              <li key={entry.workload}>
                <strong>{entry.workload}</strong>{entry.error ? <> {entry.error}</> : null}
                {Object.entries(entry.diff?.added || {}).map(([key, value]) => <div key={`a${key}`}>+ <code>{key}={value}</code></div>)}
                {Object.entries(entry.diff?.changed || {}).map(([key, [from, to]]) => <div key={`c${key}`}>~ <code>{key}: {from} → {to}</code></div>)}
                {(entry.diff?.removed || []).map(key => <div key={`r${key}`}>- <code>{key}</code></div>)}
              </li>
            ))}
          </ul>
        </details>}
      </div>}

      {action && <div className="action-status" role="status" aria-live="polite">
        <p>{action.label} → {action.text}</p>
        {action.body && <details><summary>Show response</summary><pre>{JSON.stringify(action.body, null, 2)}</pre></details>}
      </div>}

      <Queries effective={effective} />
    </section>
  );
}
