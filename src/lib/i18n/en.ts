/**
 * Canonical English dictionary. `Dict = typeof en` drives it.ts / ru.ts, so
 * every key here MUST be provided (with the same value type) by the other
 * languages or tsc fails. Interpolated strings are functions.
 */
export const en = {
  common: {
    appName: 'Luche',
    back: 'Back',
    cancel: 'Cancel',
    delete: 'Delete',
    continue: 'Continue',
    iUnderstand: 'I understand',
  },
  menu: {
    chooseTest: 'Choose a test',
    previousRecordings: 'Previous recordings',
    aboutA11y: 'About and privacy',
  },
  about: {
    title: 'About',
    subtitle: 'Movement test recorder',
    disclaimerTitle: 'Medical disclaimer',
    disclaimerBody:
      'Luche is a research and wellness tool. It is not a medical device and does not provide a diagnosis. Results are for informational purposes only — always consult a qualified clinician about your health.',
    privacyTitle: 'Privacy',
    privacyBody:
      'Recordings are saved on this device and uploaded securely to our cloud for analysis. Uploaded video, derived keypoints, analysis results, and account identifiers may be retained until you delete the recording. Deleting a completed recording removes the local copy and requests deletion from our server.',
    privacyLink: 'Privacy policy →',
    versionTitle: 'Version',
    versionValue: '1.0.0 (beta)',
    commitTitle: 'Latest GitHub commit',
    commitUnavailable: 'Commit information unavailable',
    languageTitle: 'Language',
    supportTitle: 'Support',
    diagnosticsBody:
      'Export the last 200 technical events to help diagnose recording, upload, or analysis failures. The file excludes video, keypoints, email, authentication tokens, and signed URLs.',
    exportDiagnostics: 'Export diagnostics',
    diagnosticsShareTitle: 'Share Luche diagnostics',
    diagnosticsFailedTitle: 'Could not export diagnostics',
    diagnosticsFailedBody: 'Please try again.',
  },
  disclaimer: {
    title: 'Before you start',
    body1lead: 'Luche is a research and wellness tool. It is ',
    notMedicalDevice: 'not a medical device',
    body1tail: ' and does not provide a diagnosis.',
    body2:
      'Results are for informational purposes only. Always consult a qualified clinician about your health. Do not use Luche to make medical decisions.',
  },
  record: {
    cameraAccessNeeded: 'Camera access needed',
    cameraAccessBody: (name: string) =>
      `Luche uses the camera to record a short video of the ${name} test for analysis. Videos are recorded without audio.`,
    openSettings: 'Open Settings',
    grantAccess: 'Grant camera access',
    saving: 'Saving…',
    tapToStart: 'Tap to start',
    tapToEnd: 'Tap to end',
    startA11y: 'Start recording',
    endA11y: 'End recording',
    flipCamera: 'Flip camera',
    pinchToZoom: 'Pinch to zoom',
    preparing: 'Preparing camera…',
    cameraFailedTitle: 'Camera unavailable',
    cameraFailedBody: 'Luche could not start the camera. Close this screen and try again.',
    recordingFailedTitle: 'Recording not saved',
    recordingFailedBody: 'No test was uploaded. Check available storage and try again.',
  },
  resultsList: {
    title: 'Previous recordings',
    emptyTitle: 'No recordings yet',
    emptyBody: 'Complete a test and it will show up here.',
    trendsTitle: 'Your progress',
  },
  result: {
    fallbackTitle: 'Result',
    sharingUnavailableTitle: 'Sharing unavailable',
    sharingUnavailableBody: "This device can't share files.",
    shareDialogTitle: 'Save or share recording',
    couldNotShare: 'Could not share',
    deleteTitle: 'Delete recording?',
    deleteBody: 'This removes the clip from this device and deletes its uploaded video, keypoints, and result from the server.',
    deleteA11y: 'Delete recording',
    deleteFailedTitle: 'Could not delete recording',
    deleteFailedBody: 'Nothing was removed. Check your connection and try again.',
    cloudAnalysis: 'Your result',
    scoreHint: 'Lower is better. This is an automated estimate, not a diagnosis.',
    gradeLabel: (label: string) => `Severity · ${label}`,
    estimatePill: 'ESTIMATE — automated screening, not a diagnosis',
    samplePill: 'SAMPLE — placeholder result, not real analysis',
    analysisFailed: 'Analysis failed. Please try recording again.',
    retry: 'Retry',
    failedRetry: 'Something went wrong. It will keep trying — or tap Retry.',
    permanentFailed: 'This recording can’t be uploaded. Please record it again.',
    uploading: 'Uploading to server…',
    processing: 'Processing on server…',
    saveShare: 'Save / share video',
    backToMenu: 'Back to menu',
  },
  status: {
    uploading: 'Uploading…',
    processing: 'Processing…',
    done: 'Done',
    failed: 'Failed',
  },
  uploadBanner: {
    keepOpen: (n: number) =>
      `Uploading ${n} recording${n === 1 ? '' : 's'}`,
    retrying: 'Upload failed — retrying',
    attempt: (n: number) => `attempt ${n}`,
  },
  recordingCard: {
    fallback: 'Recording',
    a11y: (name: string, date: string) => `${name} from ${date}`,
  },
  testRow: {
    startA11y: (name: string) => `Start ${name} test`,
  },
  auth: {
    signInTitle: 'Sign in to Luche',
    emailSubtitle: 'Enter your email — we’ll send a one-time code.',
    codeSubtitle: (email: string) => `Enter the code we sent to ${email}.`,
    emailPlaceholder: 'you@example.com',
    codePlaceholder: '000000',
    sendCodeError: 'Could not send a code to that email.',
    invalidCode: 'That code was not valid.',
    signInIncomplete: 'Sign-in incomplete.',
    signUpIncomplete: 'Sign-up incomplete.',
    sending: 'Sending…',
    sendCode: 'Send code',
    verifying: 'Verifying…',
    verify: 'Verify',
    useDifferentEmail: 'Use a different email',
    orContinueWithEmail: 'or continue with email',
    genericError: 'Could not sign in. Please try again.',
  },
  severity: {
    normal: 'Normal',
    slight: 'Slight',
    mild: 'Mild',
    moderate: 'Moderate',
    severe: 'Severe',
  },
  // Shared copy for the redesigned instruction screen (section labels + the
  // reassurance/CTA line). Per-test specifics live under `tests.<id>`.
  instruction: {
    demoCaption: 'Here’s what it looks like',
    setupTitle: 'Set up your phone',
    stepsTitle: 'What to do',
    tipsTitle: 'For a good result',
    ready: 'I’m ready',
    reassurance: 'There’s no wrong way to do this. You can retake it anytime.',
    notDiagnosis: 'An automated check, not a diagnosis.',
  },
  tests: {
    gait: {
      name: 'Walking',
      descriptor: 'Walk toward the camera',
      title: 'Walk in front of the camera',
      blurb: 'A quick look at how you walk.',
      timeEstimate: 'About 1 minute · do it once',
      setup:
        'Lean your phone against something steady, about 3 steps away and standing tall, so it can see you from head to toe. A helper makes this easier.',
      steps: [
        'Walk away from the phone, about 10 steps.',
        'Turn around and walk back.',
        'Do this twice if you can.',
      ],
      goodTip: 'Your whole body stays in view, in good light.',
      avoidTip: 'Standing too close, dim light, or cut off at the edges.',
    },
    arisingFromChair: {
      name: 'Standing Up from a Chair',
      descriptor: 'Stand up from a chair',
      title: 'Stand up from a chair',
      blurb: 'A quick check of standing up.',
      timeEstimate: 'Under a minute · 3 times',
      setup:
        'Prop your phone about 2–3 steps away so it can see all of you sitting in the chair.',
      steps: [
        'Sit in a firm chair with a straight back.',
        'Cross your arms over your chest.',
        'Stand up without using your hands.',
        'Sit back down and repeat, 3 times.',
      ],
      goodTip: 'Your whole body and the chair stay in view.',
      avoidTip: 'Using your hands, or sitting out of frame.',
    },
    fingerTapping: {
      name: 'Finger Tapping',
      descriptor: 'Tap finger and thumb',
      title: 'Tap your fingers',
      blurb: 'A quick check of finger movement.',
      timeEstimate: 'About 30 seconds',
      setup:
        'Hold your phone, or prop it close, so it clearly sees your hand. You can flip to the front camera to watch yourself.',
      steps: [
        'Tap your index finger on your thumb.',
        'As big and as fast as you can.',
        'Keep going for about 30 taps.',
      ],
      goodTip: 'Your hand fills the frame, in good light.',
      avoidTip: 'Hand too far away, or out of view.',
    },
  },
};

export type Dict = typeof en;
