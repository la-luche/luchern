# Luche privacy notes

This file summarizes the public policy at `https://luche.ai/privacy-policy`.
The public account-deletion instructions and request path are at
`https://luche.ai/delete-account`.

## Data used by Luche

- Account identifiers required for sign-in and account ownership.
- Movement-test videos recorded without audio.
- Temporary on-device pose, face, and person bounding boxes used for mandatory
  video de-identification before upload.
- Pose keypoints derived from uploaded videos.
- Automated experimental movement metrics and analysis status.
- A bounded on-device diagnostics log containing timestamps, technical state
  transitions, opaque recording/upload/trial/request IDs, and error/status
  codes. It does not contain video, keypoints, email, authentication tokens, or
  signed storage URLs. Diagnostics leave the device only when the user chooses
  **Export diagnostics** and shares the resulting file.

## Storage and processing

The local recording and an account-scoped recovery manifest are moved into the
app's documents directory before the review screen appears. Luche always
applies both face and background protection before any upload. Bundled
RTMDet-nano and RTMPose-t models estimate pose on every decoded frame. Luche
writes a sanitized copy and durably switches upload/playback to that copy. The
original remains local-only on the recording device and is never uploaded. It
can be viewed or explicitly exported, and is removed only when the user deletes
the recording, logs out, or deletes the account. Luche excludes the recording
directory from iCloud backup and disables Android app backup, so these local
originals are not copied into a device backup. Video frames, pose
coordinates, and blur regions are not transmitted or saved during this step.
Face regions receive coarse pixelation followed by strong blur. For background
privacy, the single largest person region stays clear while everything outside
it is coarsely pixelated and blurred; Luche does not identify or select a
patient among several people. The models run locally through ONNX Runtime on
iOS and Android without an SDK key, network license check, or model download.
If a frame has no usable person region, Luche redacts the full frame rather than
reusing an old box. If preprocessing fails or is interrupted, nothing uploads
until the user explicitly retries it. There is no send-original upload path.

The app uploads only the completed de-identified video directly to Cloudflare
R2 using a short-lived signed URL. The local de-identified copy remains on the
recording device for three days; the never-uploaded original remains until
explicit deletion. Opening an older recording requests a fresh
short-lived cloud URL instead of restoring a permanent local copy. The analysis
service reads the video and writes derived keypoints to R2. Account/trial
metadata and results are stored in the Luche database and synchronize to other
devices signed in with the same account.

## Deletion

Deleting a completed recording in the app first asks the server to cancel any
active analysis, delete the uploaded video and derived keypoints, and delete the
trial metadata/results. After the server confirms deletion, the app deletes the
local file and local metadata. If server deletion fails, the app reports the
failure and retains the local record so the user can retry.

Logging out removes every locally stored recording video and the local history
cache. If any video has not reached a server trial, Luche warns that logging out
will permanently delete it before continuing. Uploaded videos, results, and
trial metadata remain in the account and reappear after sign-in; they are only
deleted from the server through the recording's explicit Delete action.

Deleting an account is separate from logging out. The red **Delete account**
button beside **Log out** warns that deletion is irreversible, enforces a
five-second countdown, and asks for a final confirmation. After confirmation,
Luche stops local uploads and deletes local recordings and diagnostics, then
the server cancels active analysis and deletes all owned videos, derived
keypoints, experimental estimates/results, ratings, upload records, invites,
sharing relationships, account/database records, and the Clerk identity. A
share-code allocation tombstone remains without the Clerk identifier so the
old four-digit code can never be reassigned.

People who cannot access the app can request verified account deletion at
`https://luche.ai/delete-account`.

## Medical wording

Luche is a research and wellness tool. Every automated score is an
experimental estimate, not a diagnosis. The scores are not clinically
validated, and Luche is not a medical device.

## Important deployment requirement

The mobile deletion behavior depends on the matching `feral-api` deletion
endpoints being deployed before this app build is distributed.
