random image i found on google

<img width="700" height="438" alt="image" src="https://github.com/user-attachments/assets/fa9a1680-4bbc-4cf9-bf88-c47b9b2aba88" />

# CAOTAYTANG

Multi-vhost TLS reverse proxy with Cloudflare / CDN fingerprint scrubbing.
Maps `Host` headers to upstream origins, strips edge metadata from response
headers, cookies, and HTML/JS bodies.

## Requirements

- Node.js 18+
- `dnsmasq` (or any way to point lab hostnames to `127.0.0.1`)
- `openssl` (for the self-signed wildcard cert)

## Install

```bash
npm install
```

## Setup

### 1. Wildcard DNS

Point the lab domain at localhost.

```bash
sudo apt install dnsmasq
echo 'address=/own_lab.htb/127.0.0.1' | sudo tee /etc/dnsmasq.d/lab.conf
sudo systemctl restart dnsmasq
```

### 2. Wildcard TLS cert

```bash
cd certs
openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
  -keyout mylab.key -out mylab.crt \
  -subj "/CN=own_lab.htb" \
  -addext "subjectAltName=DNS:own_lab.htb,DNS:*.own_lab.htb"
```

Trust `mylab.crt` in your browser / system store.

### 3. Run

```bash
PORT=8765 ADMIN_PORT=9000 node proxy.js
```

Defaults: `PORT=8765`, `ADMIN_PORT=9000`, `CERT_DIR=./certs`.

## Usage

### Add a route

Open the dashboard: `http://127.0.0.1:9000`

1. Go to **Routes**.
2. Add `Host` (e.g. `concak.own_lab.htb`) → `Target` (e.g. `https://example.com/`).
3. Click **Save**.

Body URL-rewrite patterns are auto-generated for every route (see **Scrubbing
→ Auto-generated**).

### Hit the proxy

```bash
curl -k https://concak.own_lab.htb:8765/
```

Or open it in a browser. The `Host` header decides which upstream is used.

### Scrubbing

**Scrubbing** tab controls what gets stripped:

- Response headers (Cloudflare, CDN, edge cache, etc.)
- `Set-Cookie` names
- Body regex replacements (per-group, toggleable)

Toggle a group off to disable the whole category. Add ad-hoc entries under
**Custom**.

### Live log

**Live Log** tab streams every request through the proxy in real time.

### Reload

Click **Reload proxy** in the header after editing `config.json` outside the
dashboard, or to flush upstream keep-alive sockets.

## Environment variables

| Var          | Default        | Purpose                                |
| ------------ | -------------- | -------------------------------------- |
| `PORT`       | `8765`         | TLS listen port                        |
| `ADMIN_PORT` | `9000`         | Admin dashboard port (HTTP, loopback)  |
| `CERT_DIR`   | `./certs`      | Cert directory                         |
| `CERT`       | `mylab.crt`    | Cert file path                         |
| `KEY`        | `mylab.key`    | Key file path                          |

## Files

- `proxy.js` — TLS proxy entrypoint
- `admin.js` — dashboard HTTP server
- `config.js` — config load + compile + watch
- `config.json` — persisted routes and scrub rules
- `public/` — dashboard UI
- `certs/` — TLS cert + key
