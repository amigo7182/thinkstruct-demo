import { useState } from "react";
import { formatMs } from "../lib/format";
import { median, percentile } from "../lib/stats";
import type { LatencySample } from "../state/store";
import { useSnapshot, useStore } from "../state/StoreContext";

const DELAYS = [0, 250, 500, 1000, 2000, 3000, 5000];

function Stat({ label, samples }: { label: string; samples: LatencySample[] }) {
  const ms = samples.map((s) => s.ms);
  const med = median(ms);
  const p95 = percentile(ms, 95);
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="mono">{ms.length}</td>
      <td className="mono">{med === null ? "–" : formatMs(med)}</td>
      <td className="mono">{p95 === null ? "–" : formatMs(p95)}</td>
    </tr>
  );
}

/** Shown with ?debug=1: latency stats, and a server delay to show stale results never appear. */
export function DebugPanel() {
  const store = useStore();
  const { latency, debug } = useSnapshot();
  const [copied, setCopied] = useState<string | null>(null);
  const filterSamples = latency.samples.filter((s) => s.kind === "filter");

  async function copy() {
    const json = JSON.stringify(latency.samples, null, 2);
    try {
      await navigator.clipboard.writeText(json);
      setCopied("Copied");
    } catch {
      setCopied("Couldn't copy; see the console");
      console.info(json);
    }
    window.setTimeout(() => setCopied(null), 2000);
  }

  return (
    <aside className="debug" aria-label="Debug panel">
      <h2 className="debug-title">Debug</h2>
      <table className="debug-table">
        <thead>
          <tr>
            <th scope="col">Latency</th>
            <th scope="col">Samples</th>
            <th scope="col">Median</th>
            <th scope="col">p95</th>
          </tr>
        </thead>
        <tbody>
          <Stat label="Filter changes" samples={filterSamples} />
          <Stat label="All changes" samples={latency.samples} />
        </tbody>
      </table>
      <p className="debug-note">
        Trigger to painted, last {latency.samples.length} of up to 100.{" "}
        {debug.delayMs > 0 ? "Paused while a delay is set." : ""}
      </p>
      <div className="debug-row">
        <button type="button" className="button" onClick={copy} disabled={latency.samples.length === 0}>
          Copy samples as JSON
        </button>
        <span role="status" className="muted">
          {copied}
        </span>
      </div>
      <div className="debug-row">
        <label htmlFor="debug-delay">Server delay</label>
        <select id="debug-delay" value={debug.delayMs} onChange={(e) => store.setDelay(Number(e.target.value))}>
          {DELAYS.map((ms) => (
            <option key={ms} value={ms}>
              {ms === 0 ? "None" : `${ms} ms`}
            </option>
          ))}
        </select>
      </div>
      <div className="debug-row">
        <input
          id="debug-random"
          type="checkbox"
          checked={debug.randomDelay}
          onChange={(e) => store.setRandomDelay(e.target.checked)}
        />
        <label htmlFor="debug-random">Random delay up to that (answers arrive out of order)</label>
      </div>
      <div className="debug-row">
        <input
          id="debug-keep"
          type="checkbox"
          checked={debug.keepOlderRequests}
          onChange={(e) => store.setKeepOlderRequests(e.target.checked)}
        />
        <label htmlFor="debug-keep">Don't abort older requests (only the id check protects)</label>
      </div>
      <p className="debug-counters mono">
        sent {debug.sent} · applied {debug.applied} · aborted {debug.aborted} · stale dropped {debug.discarded}
      </p>
    </aside>
  );
}
