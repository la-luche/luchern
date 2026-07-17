# go.luche.ai

Permanent Expo Go preview for the Luche React Native app. The Raspberry Pi runs
Metro on port `8091`; a small Node gateway on `127.0.0.1:8089` serves a
browser handoff page at `/` and proxies Expo manifests, bundles, assets, and
WebSockets to Metro.

The handoff page includes a QR code containing `exps://go.luche.ai`, so a phone
camera opens the project directly in Expo Go rather than loading another web
page first.

The public flow is:

```text
https://go.luche.ai -> exps://go.luche.ai -> Expo Go -> Expo manifest/bundle
```

`exps://` matters: Expo Go translates it to HTTPS. The Expo service also sets
`EXPO_PACKAGER_PROXY_URL=https://go.luche.ai`, so every URL in the manifest uses
the public hostname instead of the Pi's LAN address.

## Pi layout

```text
/home/pi-rus/Downloads/feral-remote/luche-go/
  app/       # clone of https://github.com/la-luche/luchern
  gateway/   # server.mjs + landing.html from this directory
```

Services are user units:

```bash
systemctl --user status luche-go-expo luche-go
journalctl --user -u luche-go-expo -u luche-go -n 100
curl http://127.0.0.1:8089/_luche/health
```

Cloudflare Tunnel routes `go.luche.ai` to `http://localhost:8089`. Do not expose
Metro directly: the gateway is what makes the ordinary HTTPS URL usable in a
browser while preserving Expo's header-dependent manifest response.

## Updating the app

The Pi checkout follows `main`:

```bash
cd /home/pi-rus/Downloads/feral-remote/luche-go/app
git pull --ff-only
npm ci
systemctl --user restart luche-go-expo
```

The committed lockfile includes the resolved peer metadata required by npm 10,
so deployment uses the reproducible `npm ci` path.

Expo Go is a preview/distribution convenience, not the production app runtime.
The App Store/TestFlight build remains the durable production path.
