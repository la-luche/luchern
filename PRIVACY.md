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
app's documents directory before the review screen appears. Luche runs an
on-device face/background processing pass before any upload. Bundled
RTMDet-nano and RTMPose-t models estimate pose on every decoded frame. Luche
writes a sanitized copy and durably switches upload/playback to that copy. The
original source file remains local-only on the recording device and is never
uploaded as that file. Frames that the reliability gate rejects can pass
through unchanged in the processed upload. The local original can be viewed or
explicitly exported, and is removed only when the user deletes
the recording, logs out, or deletes the account. Luche excludes the recording
directory from iCloud backup and disables Android app backup, so these local
originals are not copied into a device backup. Video frames, pose
coordinates, and blur regions are not transmitted or saved during this step.
Face regions receive coarse pixelation followed by strong blur. For background
privacy, the single largest person region stays clear while everything outside
it is coarsely pixelated and blurred; Luche does not identify or select a
patient among several people. The models run locally through ONNX Runtime on
iOS and Android without an SDK key, network license check, or model download.
Processing uses independent, non-overlapping 0.5-second windows. A window with
low joint confidence and large residual joint jumps, or without a usable body
region, is left unchanged. Reliable windows receive background blur, and face
blur is added only when at least three face keypoints pass confidence. If
preprocessing fails or is interrupted, nothing uploads until the user retries.

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
