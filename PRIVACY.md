# Luche privacy notes

This file summarizes the public policy at `https://luche.ai/privacy-policy`.
The public account-deletion instructions and request path are at
`https://luche.ai/delete-account`.

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
URL. Uploaded clips remain on the recording device for three days, then the
local copy is deleted. Opening an older recording requests a fresh short-lived
cloud URL instead of restoring a permanent local copy. The analysis service
reads the video and writes derived keypoints to R2. Account/trial metadata and
results are stored in the Luche database and synchronize to other devices
signed in with the same account.

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
