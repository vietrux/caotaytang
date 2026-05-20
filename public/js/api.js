import { $, toast } from './util.js';
import { getCfg, setCfg, setPreview, markDirty } from './state.js';
import { render, renderAutoPatterns } from './render.js';

export async function loadConfig() {
  const r = await fetch('/api/config');
  setCfg(await r.json());
  await refreshPreview();
  render();
  markDirty(false);
}

export async function refreshPreview() {
  try {
    const r = await fetch('/api/preview');
    setPreview(await r.json());
  } catch {
    /* ignore */
  }
}

export async function saveConfig() {
  const cfg = getCfg();
  cfg.proxyPort   = parseInt($('#proxy-port').value, 10) || cfg.proxyPort;
  cfg.serverDecoy = $('#server-decoy').value.trim() || 'nginx';
  cfg.scrubBody   = $('#scrub-body').checked;
  const r = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  });
  if (r.ok) {
    toast('Saved. Proxy reloaded.');
    markDirty(false);
    await refreshPreview();
    renderAutoPatterns();
  } else {
    const e = await r.json().catch(() => ({ error: 'unknown' }));
    toast('Save failed: ' + e.error, true);
  }
}

export async function reloadProxy() {
  const r = await fetch('/api/reload', { method: 'POST' });
  return { ok: r.ok, json: await r.json().catch(() => ({})) };
}

export async function fetchLog() {
  const r = await fetch('/api/log');
  return r.json();
}
