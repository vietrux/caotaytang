import { $, el } from './util.js';
import { getCfg, getPreview, markDirty } from './state.js';

export function renderRoutes() {
  const cfg = getCfg();
  const body = $('#routes-body');
  body.innerHTML = '';
  for (const [host, target] of Object.entries(cfg.routes)) {
    const hostIn = el('input', { type: 'text', value: host, 'aria-label': 'Vhost' });
    const tgtIn  = el('input', { type: 'url',  value: target, 'aria-label': 'Upstream' });
    hostIn.addEventListener('change', () => {
      const v = hostIn.value.trim();
      if (!v || v === host) return;
      cfg.routes[v] = cfg.routes[host];
      delete cfg.routes[host];
      markDirty(true);
      renderRoutes();
      updateMeta();
    });
    tgtIn.addEventListener('change', () => {
      cfg.routes[host] = tgtIn.value.trim();
      markDirty(true);
      updateMeta();
    });
    const del = el('button', {
      title: `Remove route ${host}`,
      'aria-label': `Remove route ${host}`,
      onclick: () => {
        delete cfg.routes[host];
        markDirty(true);
        renderRoutes();
        updateMeta();
      },
    }, 'Remove');
    body.append(el('tr', {},
      el('td', {}, hostIn),
      el('td', {}, tgtIn),
      el('td', {}, del),
    ));
  }
  $('#proxy-port').value = cfg.proxyPort;
  $('#server-decoy').value = cfg.serverDecoy || 'nginx';
}

export function renderItemGroups(containerId, groupsObj, addLabel) {
  const c = $(containerId);
  c.innerHTML = '';
  for (const [gk, g] of Object.entries(groupsObj)) {
    const det = el('details');
    if (g.enabled) det.setAttribute('open', '');
    const chk = el('input', { type: 'checkbox' });
    chk.checked = !!g.enabled;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      g.enabled = chk.checked;
      markDirty(true);
      updateMeta();
    });
    const countSpan = el('span', {}, ` (${(g.items || []).length} ${addLabel})`);
    const summary = el('summary', {}, chk, ' ', g.label || gk, countSpan);
    det.append(summary);

    const ta = el('textarea', {
      rows: Math.max(3, Math.min(10, (g.items || []).length + 1)),
      cols: 60,
      placeholder: 'one per line',
    }, (g.items || []).join('\n'));
    ta.addEventListener('input', () => {
      g.items = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      countSpan.textContent = ` (${g.items.length} ${addLabel})`;
      markDirty(true);
      updateMeta();
    });
    det.append(el('div', {}, ta));
    c.append(det);
  }
}

export function renderPatternGroups() {
  const cfg = getCfg();
  const c = $('#pattern-groups');
  c.innerHTML = '';
  for (const [gk, g] of Object.entries(cfg.bodyPatternGroups)) {
    const det = el('details');
    if (g.enabled) det.setAttribute('open', '');
    const chk = el('input', { type: 'checkbox' });
    chk.checked = !!g.enabled;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      g.enabled = chk.checked;
      markDirty(true);
      updateMeta();
    });
    const countSpan = el('span', {}, ` (${(g.patterns || []).length} patterns)`);
    const summary = el('summary', {}, chk, ' ', g.label || gk, countSpan);
    det.append(summary);

    const tbl = el('table');
    tbl.append(el('thead', {}, el('tr', {},
      el('th', {}, 'Pattern'),
      el('th', {}, 'Flags'),
      el('th', {}, 'Replacement'),
      el('th', {}, ''),
    )));
    const tb = el('tbody');
    (g.patterns || []).forEach((p, i) => {
      const patIn   = el('input', { type: 'text', value: p.pattern, size: 40, placeholder: 'regex' });
      const flagsIn = el('input', { type: 'text', value: p.flags || 'g', size: 4 });
      const subIn   = el('input', { type: 'text', value: p.sub != null ? p.sub : '', size: 20, placeholder: 'replacement' });
      patIn.addEventListener('change', () => { g.patterns[i].pattern = patIn.value; markDirty(true); });
      flagsIn.addEventListener('change', () => { g.patterns[i].flags = flagsIn.value; markDirty(true); });
      subIn.addEventListener('change', () => { g.patterns[i].sub = subIn.value; markDirty(true); });
      const del = el('button', {
        title: 'Remove pattern',
        'aria-label': 'Remove pattern',
        onclick: () => {
          g.patterns.splice(i, 1);
          markDirty(true);
          renderPatternGroups();
          updateMeta();
        },
      }, 'Remove');
      tb.append(el('tr', {},
        el('td', {}, patIn),
        el('td', {}, flagsIn),
        el('td', {}, subIn),
        el('td', {}, del),
      ));
    });
    tbl.append(tb);
    det.append(tbl);
    det.append(el('p', {}, el('button', {
      onclick: () => {
        g.patterns.push({ pattern: '', flags: 'g', sub: '' });
        markDirty(true);
        renderPatternGroups();
      },
    }, 'Add pattern')));
    c.append(det);
  }
}

export function renderAutoPatterns() {
  const preview = getPreview();
  const c = $('#auto-patterns');
  c.innerHTML = '';
  if (!preview.autoPatterns || !preview.autoPatterns.length) {
    c.append(el('p', {}, el('small', {}, 'No routes configured — nothing to auto-generate.')));
    return;
  }
  const tbl = el('table');
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Pattern'),
    el('th', {}, 'Flags'),
    el('th', {}, 'Replacement'),
  )));
  const tb = el('tbody');
  for (const p of preview.autoPatterns) {
    tb.append(el('tr', {},
      el('td', {}, el('code', {}, p.pattern)),
      el('td', {}, p.flags),
      el('td', {}, el('code', {}, p.sub)),
    ));
  }
  tbl.append(tb);
  c.append(tbl);
}

export function updateMeta() {
  const cfg = getCfg();
  const routes = Object.keys(cfg.routes).length;
  const hdrCount  = Object.values(cfg.stripHeaderGroups).reduce((a, g) => a + (g.enabled ? g.items.length : 0), 0);
  const cookCount = Object.values(cfg.stripCookieGroups).reduce((a, g) => a + (g.enabled ? g.items.length : 0), 0);
  const patCount  = Object.values(cfg.bodyPatternGroups).reduce((a, g) => a + (g.enabled ? g.patterns.length : 0), 0);
  $('#meta').textContent =
    `${routes} routes · ${hdrCount} headers · ${cookCount} cookies · ${patCount} body patterns · scrub ${cfg.scrubBody ? 'on' : 'off'}`;
}

export function render() {
  const cfg = getCfg();
  renderRoutes();
  $('#scrub-body').checked = !!cfg.scrubBody;
  renderItemGroups('#header-groups', cfg.stripHeaderGroups, 'headers');
  renderItemGroups('#cookie-groups', cfg.stripCookieGroups, 'cookies');
  renderPatternGroups();
  renderAutoPatterns();
  updateMeta();
}
