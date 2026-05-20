import { $, toast } from './util.js';
import { isDirty } from './state.js';
import { loadConfig, fetchLog } from './api.js';

let logEl;

export function appendLog(entry) {
  if (!logEl) logEl = $('#log');
  const ts = new Date(entry.ts).toISOString().slice(11, 23);
  let line;
  if (entry.event) {
    line = `${ts} [${entry.event}] ${JSON.stringify(entry)}`;
  } else if (entry.error) {
    line = `${ts} ERR ${entry.method || ''} ${entry.host || ''}${entry.url || ''} :: ${entry.error}`;
  } else {
    const scr = entry.scrubbed ? ' [scrub]' : '';
    line = `${ts} ${entry.status} ${entry.method} ${entry.host}${entry.url}${scr}`;
  }
  const row = document.createElement('div');
  row.textContent = line;
  logEl.appendChild(row);
  while (logEl.children.length > 500) logEl.removeChild(logEl.firstChild);
  if ($('#autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
}

export async function primeLog() {
  const arr = await fetchLog();
  arr.forEach(appendLog);
}

export function setConn(txt) {
  $('#connText').textContent = txt;
}

export function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => setConn('connected'));
  es.addEventListener('log', (e) => appendLog(JSON.parse(e.data)));
  es.addEventListener('config', async () => {
    if (!isDirty()) await loadConfig();
    else toast('Config changed on disk — discard to view', true);
  });
  es.onerror = () => {
    setConn('reconnecting…');
    es.close();
    setTimeout(connectSSE, 2000);
  };
}
