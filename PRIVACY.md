# Luche privacy notes

This file is the source copy for the public Luche privacy page. It must be
reviewed and published at `https://getferal.ai/luche-privacy` before store
submission.

## Data used by Luche

- Account identifiers required for sign-in and account ownership.
- Movement-test videos recorded without audio.
- Temporary on-device face bounding boxes when optional face blurring is enabled.
- Pose keypoints derived from uploaded videos.
- Automated experimental movement metrics and analysis status.
- A bounded on-device diagnostics log containing timestamps, technical state
  transitions, opaque recording/upload/trial/request IDs, and error/status
  codes. It does not contain video, keypoints, email, authentication tokens, or
  signed storage URLs. Diagnostics leave the device only when the user chooses
  **Export diagnostics** and shares the resulting file.

## Storage and processing

The local recording is moved into the app's documents directory after capture.
**Blur faces before upload** is optional and off by default. When enabled, the
same bundled face detector runs locally on iOS and Android. Video frames and
face boxes do not leave the device during this step. Luche writes a sanitized
copy, durably switches the recording to that copy, and permanently deletes the
original before upload starts. Face boxes are not saved. If preprocessing
fails, nothing uploads until the user retries or explicitly chooses **Send
without face blurring**; in that case the original is uploaded.

The app uploads the selected video directly to Cloudflare R2 using a short-lived
signed URL. Uploaded clips remain on the recording device for three days, then
the local copy is deleted. Opening an older recording requests a fresh
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

## Important deployment requirement

The mobile deletion behavior depends on the matching `feral-api` deletion
endpoints being deployed before this app build is distributed.
