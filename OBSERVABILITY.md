# Luche reliability and observability runbook

## What is available now

The app keeps the latest 200 privacy-scrubbed lifecycle events on device. A user
can open **About → Export diagnostics** and send the JSON file to support. It
contains app/SDK/platform, timestamps, request IDs, local recording IDs, upload
IDs, and trial IDs. It does not intentionally contain video, keypoints, email,
auth tokens, response bodies, or signed URLs; string values receive a final
redaction pass before storage.

Each JSON API request carries `X-Request-ID`, `X-Luche-Version`, and
`X-Luche-Platform`. The Flask response echoes the request ID and its access log
records request ID, route, status, latency, version, and platform. Direct R2
uploads cannot use that API request ID, so `upload_id` is their correlation key.
The analysis worker logs both `trial` and its RunPod job ID.

Trace a failed report in this order:

1. Find the first failed event in the exported JSON and copy its `requestId`,
   `uploadId`, or `jobId`.
2. Search API logs by request or upload ID.
3. Search worker logs by the trial/job ID returned by `trial_created`.
4. Check RunPod with the logged RunPod job ID and R2 with the server-owned object
   key. Never ask a user to send the recording unless they explicitly consent.

Example production searches on the Pi:

```bash
journalctl --user -u feral-api --since today | rg 'request_id=rn-...|upload_id=...'
journalctl --user -u feral-analysis-worker --since today | rg 'trial=123|job_id=...'
```

## Alerts and dashboards to add before a broad rollout

The exported log helps after a user reports a problem; it is not proactive.
Add Sentry (or an equivalent privacy-configured error service) to the Expo app,
Flask API, and worker. Tag events with environment, release/build, platform,
request ID, upload ID, and trial ID. Disable screenshots/session replay and
scrub auth headers, request/response bodies, URLs, email, video, and keypoints.

Track these funnel counters and timings in a metrics backend:

- recording saved → bytes uploaded → trial created → analysis started → done;
- upload failures by network/API/R2 stage and HTTP status;
- upload size and duration, trial queue wait, RunPod runtime, and total latency;
- analysis failures/timeouts, cancellation/deletion failures, and retries;
- count/age/bytes of expired `pending_uploads` and any orphan R2 objects.

Alert on a sustained rise in failure rate, p95 latency, stuck queued/running
jobs, or expired pending bytes—not on single-user network blips.

## Operational cleanup

A killed app can leave an unconsumed R2 upload even though its DB intent expires.
Deploy the included `feral-upload-cleanup.timer`. It selects expired
`pending_uploads` after a grace period, deletes each R2 object first, and deletes
the DB row only after storage deletion succeeds. The ordering keeps failures
retryable. Until that timer is enabled, monitor expired intent count and treat
it as a rollout blocker for unbounded retention.

## Incident checklist

1. Identify affected release/platform and the earliest failing stage.
2. Correlate request → upload → trial → RunPod job.
3. Separate client connectivity, API, R2, queue, and model-worker failures.
4. Preserve only metadata needed to debug; do not copy raw patient media into
   logs or Sentry.
5. Record the fix and add an automated check or alert for the same failure mode.
