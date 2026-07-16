# Luche privacy notes

This file is the source copy for the public Luche privacy page. It must be
reviewed and published at `https://getferal.ai/luche-privacy` before store
submission.

## Data used by Luche

- Account identifiers required for sign-in and account ownership.
- Movement-test videos recorded without audio.
- Pose keypoints derived from uploaded videos.
- Automated experimental movement metrics and analysis status.
- A bounded on-device diagnostics log containing timestamps, technical state
  transitions, opaque recording/upload/trial/request IDs, and error/status
  codes. It does not contain video, keypoints, email, authentication tokens, or
  signed storage URLs. Diagnostics leave the device only when the user chooses
  **Export diagnostics** and shares the resulting file.

## Storage and processing

The local recording is moved into the app's documents directory after capture.
The app uploads the video directly to Cloudflare R2 using a short-lived signed
URL. The analysis service reads the video and writes derived keypoints to R2.
Account/trial metadata and results are stored in the Luche database.

## Deletion

Deleting a completed recording in the app first asks the server to cancel any
active analysis, delete the uploaded video and derived keypoints, and delete the
trial metadata/results. After the server confirms deletion, the app deletes the
local file and local metadata. If server deletion fails, the app reports the
failure and retains the local record so the user can retry.

## Important deployment requirement

The mobile deletion behavior depends on the matching `feral-api` deletion
endpoints being deployed before this app build is distributed.
