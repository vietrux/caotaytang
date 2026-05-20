import { $, esc, toast } from './util.js';
import { isDirty } from './state.js';
import { loadConfig, fetchLog } from './api.js';

let logEl;

export function appendLog(entry) {
  if (!logEl) logEl = $('#log');
  const ts = new Date(entry.ts).toISOString().slice(11, 23);
  let line;
  if (entry.event) {
    line = `<span class="ts">${ts}</span> <span class="ev">[${esc(entry.event)}]</span> ${esc(JSON.stringify(entry))}`;
  } else if (entry.error) {
    line = `<span class="ts">${ts}</span> <span class="err">ERR</span> ${esc(entry.method || '')} ${esc(entry.host || '')}${esc(entry.url || '')} :: ${esc(entry.error)}`;
  } else {
    const sClass =
      entry.status >= 500 ? 's5' :
      entry.status >= 400 ? 's4' : 's2';
    const scr = entry.scrubbed ? ' [scrub]' : '';
    line = `<span class="ts">${ts}</span> <span class="${sClass}">${entry.status}</span> <span class="m">${esc(entry.method)}</span> ${esc(entry.host)}${esc(entry.url)}${scr}`;
  }
  const row = document.createElement('div');
  row.className = 'log-row';
  row.innerHTML = line;
  logEl.appendChild(row);
  while (logEl.children.length > 500) logEl.removeChild(logEl.firstChild);
  if ($('#autoscroll').checked) logEl.scrollTop = logEl.scrollHeight;
}

export async function primeLog() {
  const arr = await fetchLog();
  arr.forEach(appendLog);
}

export function setConn(on, txt) {
  $('#conn').classList.toggle('on', on);
  $('#connText').textContent = txt;
}

export function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('hello', () => setConn(true, 'connected'));
  es.addEventListener('log', (e) => appendLog(JSON.parse(e.data)));
  es.addEventListener('config', async () => {
    if (!isDirty()) await loadConfig();
    else toast('Config changed on disk — discard to view', true);
  });
  es.onerror = () => {
    setConn(false, 'reconnecting…');
    es.close();
    setTimeout(connectSSE, 2000);
  };
}
