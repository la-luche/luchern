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
      'Recordings are stored on your device. Analysis is performed in the cloud only when you record a test. Nothing else is collected.',
    privacyLink: 'Privacy policy →',
    versionTitle: 'Version',
    versionValue: '1.0.0 (beta)',
    languageTitle: 'Language',
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
      `Luche records a short video of the ${name} test to analyze it. The camera and microphone are used only while you record.`,
    openSettings: 'Open Settings',
    grantAccess: 'Grant camera access',
    saving: 'Saving…',
    tapToStart: 'Tap to start',
    tapToEnd: 'Tap to end',
    startA11y: 'Start recording',
    endA11y: 'End recording',
    flipCamera: 'Flip camera',
    pinchToZoom: 'Pinch to zoom',
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
    deleteBody: 'This removes the clip from this device.',
    deleteA11y: 'Delete recording',
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
      `Uploading ${n} recording${n === 1 ? '' : 's'} — keep the app open`,
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
  tests: {
    gait: {
      name: 'Walking',
      descriptor: 'Walk toward the camera',
      title: 'Walk in front of the camera',
      steps: [
        'Walk 10 steps away from the camera',
        'Turn around and walk 10 steps back',
        'Tap Start when you’re ready to begin',
      ],
    },
    arisingFromChair: {
      name: 'Standing Up from a Chair',
      descriptor: 'Stand up from a chair',
      title: 'Stand up from a chair',
      steps: [
        'Sit in a straight-back chair',
        'Cross your arms over your chest',
        'Stand up without using your hands',
        'Repeat 3 times',
        'Tap Start when you’re ready to begin',
      ],
    },
    fingerTapping: {
      name: 'Finger Tapping',
      descriptor: 'Tap finger and thumb',
      title: 'Tap your fingers',
      steps: [
        'Tap your index finger against your thumb',
        'As quickly and as widely as you can',
        'About 30 taps',
        'Tap Start when you’re ready to begin',
      ],
    },
  },
};

export type Dict = typeof en;
