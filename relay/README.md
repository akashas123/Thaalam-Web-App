# India hosted JioSaavn relay

This small Node service forwards authenticated `GET /api.php?...` requests to
the fixed JioSaavn API host. It does not proxy arbitrary URLs or audio streams.
The Cloudflare Worker calls it for catalogue/search requests; playback audio
continues to stream from JioSaavn's CDN directly to the browser.

## Deploy on the existing Ubuntu 24.04 ARM64 VM

The existing `radio.thaalam24x7.in` record serves AzuraCast, so leave it
untouched. Publish `saavn-relay.thaalam24x7.in` through Cloudflare Tunnel; do
not point it directly at the VM or expose port 8788 publicly.

### 1. Preserve the existing web server

AzuraCast already owns ports 80 and 443 on this VM. Do not install another web
server or change AzuraCast's port mappings. Use a Cloudflare Tunnel to publish
the relay's loopback-only port instead; the relay does not need any inbound OCI
firewall rule.

### 2. Copy the relay file

From PowerShell in the project directory, run this command (use your normal SSH
key options if your key is not in the default location):

```powershell
scp .\relay\server.mjs ubuntu@68.233.117.57:/tmp/saavn-relay-server.mjs
```

Then SSH to the VM and run:

```sh
sudo apt update
sudo apt install -y nodejs
node --version
sudo useradd --system --home-dir /opt/saavn-relay --shell /usr/sbin/nologin saavn-relay
sudo install -d -o saavn-relay -g saavn-relay /opt/saavn-relay
sudo install -o saavn-relay -g saavn-relay -m 0644 /tmp/saavn-relay-server.mjs /opt/saavn-relay/server.mjs
openssl rand -hex 32
```

Copy the generated token somewhere private temporarily. Create the root-only
environment file with `sudo nano /etc/saavn-relay.env` and add:

```text
JIOSAAVN_RELAY_TOKEN=paste-the-generated-token-here
PORT=8788
```

Then secure it and create the systemd service:

```sh
sudo chmod 600 /etc/saavn-relay.env
sudo chown root:root /etc/saavn-relay.env
```

Create `/etc/systemd/system/saavn-relay.service` with this service definition:

```ini
[Unit]
Description=JioSaavn API relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=saavn-relay
Group=saavn-relay
EnvironmentFile=/etc/saavn-relay.env
ExecStart=/usr/bin/node /opt/saavn-relay/server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

Start the relay:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now saavn-relay
```

### 3. Publish through Cloudflare Tunnel

Create or use a remotely managed Cloudflare Tunnel. Add a **Published
application** route for `saavn-relay.thaalam24x7.in` with service URL
`http://localhost:8788`. Install the tunnel connector on this VM using the
command/token shown by the Cloudflare dashboard. Remove the old A record for
`saavn-relay.thaalam24x7.in` if present; Cloudflare will create the tunnel DNS
record. Do not change the `radio.thaalam24x7.in` record.

Once the tunnel is connected, check
`https://saavn-relay.thaalam24x7.in/health` returns `{"ok":true}`.

## Configure Cloudflare

In the Pages project's **Settings > Variables and Secrets** (or the Worker
settings for a direct-upload deployment), add:

- `JIOSAAVN_RELAY_URL`: `https://saavn-relay.thaalam24x7.in/api.php`
- `JIOSAAVN_RELAY_TOKEN`: the same random token set on the VM, stored as a
  secret in Cloudflare

Redeploy the site. When these values are absent, local development continues
to call JioSaavn directly. Do not set the token as a Vite variable; it must only
exist in the server-side Cloudflare runtime and the relay service.
