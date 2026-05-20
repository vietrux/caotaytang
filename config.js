const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');

// proxyPort is what the *browser* uses (for body URL rewrites).
// PORT env still controls the actual listen socket in proxy.js.
const DEFAULT_PROXY_PORT = parseInt(process.env.PORT || '8765', 10);

const DEFAULT = {
  proxyPort: DEFAULT_PROXY_PORT,
  scrubBody: false,
  serverDecoy: 'nginx',
  routes: {
    'lab1_adapi.mylab': 'https://adapi.assol24.com',
    'lab1_admin.mylab': 'https://admin.assol24.com',
  },
  stripHeaderGroups: {
    cloudflare: {
      label: 'Cloudflare',
      enabled: true,
      items: [
        'cf-ray', 'cf-cache-status', 'cf-request-id', 'cf-apo-via',
        'cf-bgj', 'cf-polished', 'cf-worker', 'cf-connecting-ip',
        'cf-ipcountry', 'cf-visitor',
      ],
    },
    cdnEdge: {
      label: 'CDN / Edge',
      enabled: true,
      items: [
        'expect-ct', 'report-to', 'nel', 'alt-svc', 'server-timing',
        'x-served-by', 'x-cache', 'x-cache-hits', 'x-amz-cf-id',
        'fastly-debug-digest', 'x-timer',
      ],
    },
    serverId: {
      label: 'Server Identity',
      enabled: true,
      items: ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version'],
    },
    sharepoint: {
      label: 'SharePoint / IIS',
      enabled: false,
      items: [
        'microsoftsharepointteamservices', 'x-sharepointhealthscore',
        'sprequestguid', 'sprequestduration', 'spiislatency',
        'x-ms-invokeapp', 'request-id',
      ],
    },
    custom: { label: 'Custom', enabled: true, items: [] },
  },
  stripCookieGroups: {
    cloudflare: {
      label: 'Cloudflare',
      enabled: true,
      items: ['__cf_bm', '__cfduid', '__cflb', 'cf_clearance', '_cfuvid'],
    },
    custom: { label: 'Custom', enabled: true, items: [] },
  },
  bodyPatternGroups: {
    cloudflare: {
      label: 'Cloudflare cleanup',
      enabled: true,
      patterns: [
        { pattern: 'https?://[a-z0-9.-]*cloudflareinsights\\.com[^"\'\\s<>]*', flags: 'gi', sub: '' },
        { pattern: '<script[^>]+cloudflareinsights[^<]*</script>', flags: 'gi', sub: '' },
        { pattern: '/cdn-cgi/[^"\'\\s<>)]*', flags: 'g', sub: '/_' },
        { pattern: '\\sdata-cf-[a-z0-9-]+="[^"]*"', flags: 'gi', sub: '' },
        { pattern: '\\scf-[a-z0-9-]+="[^"]*"', flags: 'gi', sub: '' },
        { pattern: 'cloudflare', flags: 'gi', sub: 'origin' },
      ],
    },
    custom: { label: 'Custom', enabled: true, patterns: [] },
  },
};

const KNOWN_HEADERS = new Set();
const KNOWN_COOKIES = new Set();
for (const g of Object.values(DEFAULT.stripHeaderGroups)) g.items.forEach(h => KNOWN_HEADERS.add(h.toLowerCase()));
for (const g of Object.values(DEFAULT.stripCookieGroups)) g.items.forEach(c => KNOWN_COOKIES.add(c.toLowerCase()));

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

// Migrate legacy flat-array schema -> grouped schema. Non-default items go to "custom".
function migrate(raw) {
  if (raw.stripHeaderGroups || raw.stripCookieGroups || raw.bodyPatternGroups) {
    // assume already migrated; just fill in missing groups from DEFAULT
    const out = {
      ...DEFAULT,
      ...raw,
      stripHeaderGroups: mergeGroups(DEFAULT.stripHeaderGroups, raw.stripHeaderGroups || {}),
      stripCookieGroups: mergeGroups(DEFAULT.stripCookieGroups, raw.stripCookieGroups || {}),
      bodyPatternGroups: mergeGroups(DEFAULT.bodyPatternGroups, raw.bodyPatternGroups || {}),
    };
    return out;
  }
  // legacy: stripHeaders/stripCookies/bodyPatterns flat
  const out = deepClone(DEFAULT);
  out.proxyPort = raw.proxyPort || out.proxyPort;
  out.scrubBody = !!raw.scrubBody;
  out.serverDecoy = raw.serverDecoy || out.serverDecoy;
  out.routes = raw.routes || out.routes;
  if (Array.isArray(raw.stripHeaders)) {
    const extra = raw.stripHeaders.filter(h => !KNOWN_HEADERS.has(h.toLowerCase()));
    if (extra.length) out.stripHeaderGroups.custom.items = extra;
  }
  if (Array.isArray(raw.stripCookies)) {
    const extra = raw.stripCookies.filter(c => !KNOWN_COOKIES.has(c.toLowerCase()));
    if (extra.length) out.stripCookieGroups.custom.items = extra;
  }
  if (Array.isArray(raw.bodyPatterns)) {
    const knownKeys = new Set();
    for (const g of Object.values(out.bodyPatternGroups)) {
      for (const p of g.patterns) knownKeys.add(p.pattern + '|' + (p.flags || 'g'));
    }
    const extras = raw.bodyPatterns.filter(p => !knownKeys.has(p.pattern + '|' + (p.flags || 'g')));
    if (extras.length) out.bodyPatternGroups.custom.patterns = extras;
  }
  return out;
}

function mergeGroups(defaults, user) {
  const out = {};
  // start from defaults so missing groups get sensible content
  for (const [k, v] of Object.entries(defaults)) out[k] = deepClone(v);
  // then overlay user values (existing keys overwrite, new keys add)
  for (const [k, v] of Object.entries(user)) {
    out[k] = { ...(out[k] || {}), ...v };
  }
  return out;
}

// Build URL-rewrite patterns from routes so adding a route auto-scrubs upstream
// host references in HTML/JS bodies. Returns array of {pattern, flags, sub}.
function generateRoutePatterns(routes, proxyPort) {
  const out = [];
  const seen = new Set();
  for (const [host, target] of Object.entries(routes || {})) {
    let u;
    try { u = new URL(target); } catch { continue; }
    const upstream = u.hostname;
    if (seen.has(upstream)) continue;
    seen.add(upstream);
    const upstreamEsc = upstream.replace(/[.\\+*?^$()|[\]{}]/g, '\\$&');
    const vhostUrl = `https://${host}:${proxyPort}`;
    const vhostProto = `//${host}:${proxyPort}`;
    out.push(
      { pattern: `https?://(?:[a-z0-9-]+\\.)*${upstreamEsc}(?::\\d+)?`, flags: 'gi', sub: vhostUrl },
      { pattern: `//(?:[a-z0-9-]+\\.)*${upstreamEsc}(?::\\d+)?`, flags: 'gi', sub: vhostProto },
      { pattern: `https?:\\\\u002f\\\\u002f(?:[a-z0-9-]+\\.)*${upstreamEsc}(?::\\d+)?`, flags: 'gi', sub: `https:\\u002f\\u002f${host}:${proxyPort}` },
      { pattern: `(?:[a-z0-9-]+\\.)*${upstreamEsc}`, flags: 'gi', sub: host },
    );
  }
  return out;
}

class Config extends EventEmitter {
  constructor() {
    super();
    this.path = CONFIG_PATH;
    this.data = this.load();
    this.compiled = this.compile(this.data);
    this._suppressWatch = false;
    this.watch();
  }

  load() {
    if (!fs.existsSync(this.path)) {
      fs.writeFileSync(this.path, JSON.stringify(DEFAULT, null, 2));
      return deepClone(DEFAULT);
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      return migrate(raw);
    } catch (e) {
      console.error('[config] parse error, using defaults:', e.message);
      return deepClone(DEFAULT);
    }
  }

  compile(data) {
    const proxyPort = data.proxyPort || DEFAULT_PROXY_PORT;

    const headers = new Set();
    for (const g of Object.values(data.stripHeaderGroups || {})) {
      if (!g.enabled) continue;
      (g.items || []).forEach(h => headers.add(String(h).toLowerCase()));
    }

    const cookies = [];
    for (const g of Object.values(data.stripCookieGroups || {})) {
      if (!g.enabled) continue;
      (g.items || []).forEach(c => cookies.push(String(c).toLowerCase()));
    }

    const bodyPatterns = [];
    // user-defined groups first
    for (const g of Object.values(data.bodyPatternGroups || {})) {
      if (!g.enabled) continue;
      for (const p of (g.patterns || [])) {
        bodyPatterns.push([new RegExp(p.pattern, p.flags || 'g'), p.sub != null ? p.sub : '']);
      }
    }
    // auto-generated route-rewrite patterns last (so user patterns can pre-empt them)
    const autoPatterns = generateRoutePatterns(data.routes, proxyPort);
    for (const p of autoPatterns) {
      bodyPatterns.push([new RegExp(p.pattern, p.flags || 'g'), p.sub]);
    }

    return {
      proxyPort,
      routes: data.routes || {},
      scrubBody: !!data.scrubBody,
      serverDecoy: data.serverDecoy || 'nginx',
      stripHeaders: headers,
      stripCookies: cookies,
      bodyPatterns,
      autoPatternsPreview: autoPatterns, // for dashboard read-only display
    };
  }

  write(newData) {
    this._suppressWatch = true;
    fs.writeFileSync(this.path, JSON.stringify(newData, null, 2));
    setTimeout(() => { this._suppressWatch = false; }, 200);
    this.reload();
  }

  reload() {
    const d = this.load();
    try {
      const c = this.compile(d);
      this.data = d;
      this.compiled = c;
      this.emit('change', d);
    } catch (e) {
      console.error('[config] compile error:', e.message);
    }
  }

  watch() {
    let t = null;
    try {
      fs.watch(this.path, () => {
        if (this._suppressWatch) return;
        clearTimeout(t);
        t = setTimeout(() => this.reload(), 100);
      });
    } catch (e) {
      console.error('[config] watch failed:', e.message);
    }
  }
}

module.exports = new Config();
module.exports.generateRoutePatterns = generateRoutePatterns;
