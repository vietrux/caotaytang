import { $, toast } from './util.js';
import { getCfg, markDirty } from './state.js';
import { loadConfig, saveConfig, reloadProxy } from './api.js';
import { renderRoutes, renderServices, updateMeta } from './render.js';
import { primeLog, connectSSE } from './log.js';

const TABS = ['home', 'routes', 'services', 'scrub', 'log'];

function wireTabs() {
  document.querySelectorAll('nav button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('nav button').forEach((x) => x.removeAttribute('aria-current'));
      b.setAttribute('aria-current', 'true');
      TABS.forEach((t) => {
        $('#tab-' + t).hidden = (t !== b.dataset.tab);
      });
    });
  });
}

function wireForm() {
  $('#add-route').addEventListener('click', () => {
    const host = $('#new-host').value.trim();
    const target = $('#new-target').value.trim();
    if (!host || !target) return toast('Host and target required', true);
    const cfg = getCfg();
    cfg.routes[host] = target;
    $('#new-host').value = '';
    $('#new-target').value = '';
    markDirty(true);
    renderRoutes();
    updateMeta();
  });

  $('#scrub-body').addEventListener('change', () => {
    getCfg().scrubBody = $('#scrub-body').checked;
    markDirty(true);
    updateMeta();
  });
  $('#server-decoy').addEventListener('input', () => markDirty(true));
  $('#proxy-port').addEventListener('input', () => markDirty(true));

  $('#save').addEventListener('click', saveConfig);
  $('#discard').addEventListener('click', loadConfig);

  $('#reload-btn').addEventListener('click', async () => {
    const btn = $('#reload-btn');
    btn.disabled = true;
    btn.textContent = 'Reloading…';
    try {
      const { ok, json } = await reloadProxy();
      if (ok) toast(`Reloaded · ${json.routes} routes · sockets flushed`);
      else toast('Reload failed: ' + (json.error || 'unknown'), true);
    } catch (e) {
      toast('Reload failed: ' + e.message, true);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Reload proxy';
    }
  });

  $('#clear-log').addEventListener('click', () => {
    $('#log').innerHTML = '';
  });

  $('#add-svc').addEventListener('click', () => {
    const name   = $('#new-svc-name').value.trim();
    const target = $('#new-svc-target').value.trim();
    const portIn = $('#new-svc-port').value.trim();
    if (!name || !target) return toast('Name and target required', true);
    if (!/^[^/\s:]+:\d{1,5}$/.test(target)) return toast('Target must be host:port', true);
    const cfg = getCfg();
    if (!cfg.tcpServices) cfg.tcpServices = [];
    if (cfg.tcpServices.some(s => s.name === name)) return toast('Duplicate name', true);
    cfg.tcpServices.push({
      name,
      target,
      type: 'tcp',
      listenPort: portIn ? parseInt(portIn, 10) : null,
    });
    $('#new-svc-name').value = '';
    $('#new-svc-target').value = '';
    $('#new-svc-port').value = '';
    markDirty(true);
    renderServices();
    updateMeta();
  });

  $('#auto-port-lo').addEventListener('input', () => {
    const cfg = getCfg();
    cfg.tcpAutoPortRange = cfg.tcpAutoPortRange || [20000, 29999];
    cfg.tcpAutoPortRange[0] = parseInt($('#auto-port-lo').value, 10) || cfg.tcpAutoPortRange[0];
    markDirty(true);
  });
  $('#auto-port-hi').addEventListener('input', () => {
    const cfg = getCfg();
    cfg.tcpAutoPortRange = cfg.tcpAutoPortRange || [20000, 29999];
    cfg.tcpAutoPortRange[1] = parseInt($('#auto-port-hi').value, 10) || cfg.tcpAutoPortRange[1];
    markDirty(true);
  });
}

(async () => {
  wireTabs();
  wireForm();
  await loadConfig();
  await primeLog();
  connectSSE();
})();
