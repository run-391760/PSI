# Deploying SynapseSEO on a Compute Engine VM

The VM runs two containers: `synapseseo` (the app, embedded PostgreSQL on `/var/lib/synapseseo`) and
`caddy` (HTTPS with automatic Let's Encrypt certificates). Everything is set up by
[`gce-startup.sh`](gce-startup.sh), installed as the VM's startup script, which runs on every boot.

## First deployment

```sh
gcloud compute instances add-metadata synapseseo --zone asia-south1-b \
  --metadata-from-file startup-script=deploy/gce-startup.sh
gcloud compute instances stop synapseseo --zone asia-south1-b
gcloud compute instances start synapseseo --zone asia-south1-b
# follow progress (the first build takes a few minutes)
gcloud compute instances get-serial-port-output synapseseo --zone asia-south1-b | grep "SynapseSEO"
```

Requirements: the VM has the `http-server` and `https-server` network tags (ports 80/443) and a static
external IP. The site is served at `https://<ip-with-dashes>.sslip.io` unless you set a domain.

## Update to the latest code

Push to `main`, then **stop and start** the VM (a graceful shutdown lets the database close cleanly;
do not use `reset`, which is a hard power-off):

```sh
gcloud compute instances stop synapseseo --zone asia-south1-b && gcloud compute instances start synapseseo --zone asia-south1-b
```

## Configuration (instance metadata)

| Key | Purpose |
|---|---|
| `synapseseo-domain` | Custom domain (point an A record at the VM's IP first) |
| `synapseseo-invite-code` | Sign-up invite code (sign-ups are invite-only in production) |
| `synapseseo-env` | Extra environment lines: `DATAFORSEO_LOGIN=…`, `OPENAI_API_KEY=…`, `GOOGLE_CLIENT_ID=…`, … |
| `synapseseo-branch` | Branch to deploy (default `main`) |

```sh
gcloud compute instances add-metadata synapseseo --zone asia-south1-b --metadata-from-file synapseseo-env=prod.env
```

Metadata is readable by project members with Compute access; keep that in mind for API keys. The
token-encryption secret (`APP_SECRET`) is generated on the VM and never leaves it.

## Backups

The database lives on the boot disk (`/var/lib/synapseseo`). Attach a snapshot schedule to the disk
(Compute Engine → Snapshots → Snapshot schedules) for daily backups.
