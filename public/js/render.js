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
      class: 'btn ghost icon',
      title: `Remove route ${host}`,
      'aria-label': `Remove route ${host}`,
      onclick: () => {
        delete cfg.routes[host];
        markDirty(true);
        renderRoutes();
        updateMeta();
      },
    }, '×');
    const row = el('div', { class: 'rt-row' },
      el('div', { class: 'cell' }, hostIn),
      el('div', { class: 'cell' }, tgtIn),
      el('div', { class: 'cell action' }, del),
    );
    body.append(row);
  }
  $('#proxy-port').value = cfg.proxyPort;
  $('#server-decoy').value = cfg.serverDecoy || 'nginx';
}

export function renderItemGroups(containerId, groupsObj, addLabel) {
  const c = $(containerId);
  c.innerHTML = '';
  for (const [gk, g] of Object.entries(groupsObj)) {
    const det = el('details', { class: 'group' + (g.enabled ? '' : ' disabled') });
    if (g.enabled) det.setAttribute('open', '');
    const chk = el('input', { type: 'checkbox' });
    chk.checked = !!g.enabled;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      g.enabled = chk.checked;
      det.classList.toggle('disabled', !chk.checked);
      markDirty(true);
      updateMeta();
    });
    const summary = el('summary', {},
      el('span', { class: 'chev' }, '›'),
      chk,
      el('span', { class: 'group-row' },
        el('span', { class: 'label' }, g.label || gk),
        el('span', { class: 'count' }, `${(g.items || []).length} ${addLabel}`),
      ),
    );
    det.append(summary);

    const ta = el('textarea', {
      rows: Math.max(3, Math.min(10, (g.items || []).length + 1)),
      placeholder: 'one per line',
    }, (g.items || []).join('\n'));
    ta.addEventListener('input', () => {
      g.items = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
      summary.querySelector('.count').textContent = `${g.items.length} ${addLabel}`;
      markDirty(true);
      updateMeta();
    });
    det.append(el('div', { class: 'body' }, ta));
    c.append(det);
  }
}

export function renderPatternGroups() {
  const cfg = getCfg();
  const c = $('#pattern-groups');
  c.innerHTML = '';
  for (const [gk, g] of Object.entries(cfg.bodyPatternGroups)) {
    const det = el('details', { class: 'group' + (g.enabled ? '' : ' disabled') });
    if (g.enabled) det.setAttribute('open', '');
    const chk = el('input', { type: 'checkbox' });
    chk.checked = !!g.enabled;
    chk.addEventListener('click', (e) => e.stopPropagation());
    chk.addEventListener('change', () => {
      g.enabled = chk.checked;
      det.classList.toggle('disabled', !chk.checked);
      markDirty(true);
      updateMeta();
    });
    const summary = el('summary', {},
      el('span', { class: 'chev' }, '›'),
      chk,
      el('span', { class: 'group-row' },
        el('span', { class: 'label' }, g.label || gk),
        el('span', { class: 'count' }, `${(g.patterns || []).length} patterns`),
      ),
    );
    det.append(summary);

    const body = el('div', { class: 'body' });
    (g.patterns || []).forEach((p, i) => {
      const grid = el('div', { class: 'pat-grid' });
      const patIn   = el('input', { type: 'text', value: p.pattern, placeholder: 'regex' });
      const flagsIn = el('input', { type: 'text', value: p.flags || 'g', placeholder: 'flags' });
      const subIn   = el('input', { type: 'text', value: p.sub != null ? p.sub : '', placeholder: 'replacement' });
      patIn.addEventListener('change', () => { g.patterns[i].pattern = patIn.value; markDirty(true); });
      flagsIn.addEventListener('change', () => { g.patterns[i].flags = flagsIn.value; markDirty(true); });
      subIn.addEventListener('change', () => { g.patterns[i].sub = subIn.value; markDirty(true); });
      const del = el('button', {
        class: 'btn ghost icon',
        title: 'Remove pattern',
        'aria-label': 'Remove pattern',
        onclick: () => {
          g.patterns.splice(i, 1);
          markDirty(true);
          renderPatternGroups();
          updateMeta();
        },
      }, '×');
      grid.append(patIn, flagsIn, subIn, del);
      body.append(grid);
    });
    body.append(el('button', {
      class: 'btn ghost',
      style: 'margin-top: var(--s-2);',
      onclick: () => {
        g.patterns.push({ pattern: '', flags: 'g', sub: '' });
        markDirty(true);
        renderPatternGroups();
      },
    }, '+ Add pattern'));
    det.append(body);
    c.append(det);
  }
}

export function renderAutoPatterns() {
  const preview = getPreview();
  const c = $('#auto-patterns');
  c.innerHTML = '';
  if (!preview.autoPatterns || !preview.autoPatterns.length) {
    c.append(el('p', { class: 'hint' }, 'No routes configured — nothing to auto-generate.'));
    return;
  }
  const tbl = el('table');
  tbl.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Pattern'),
    el('th', { style: 'width:60px' }, 'Flags'),
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
