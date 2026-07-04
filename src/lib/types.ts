import type { TestId } from './tests';

/**
 * Lifecycle of a recording as it moves through the (placeholder) cloud
 * pipeline. `uploading` → `processing` → `done`, or `failed` on error.
 * Mirrors the status pill shown on each results card.
 */
export type RecordingStatus = 'uploading' | 'processing' | 'done' | 'failed';

/** Analysis result from the cloud keypoint→MDS-UPDRS pipeline (see cloud.ts). */
export interface CloudResult {
  /** 0–1 normalized severity, same convention the Swift app stored. */
  score: number;
  /** Human-readable summary label, e.g. "Mild". */
  label: string;
  /** True only for the old placeholder path; real results set false. */
  isDemo: boolean;
  /** Real results are literature-heuristic estimates, not a diagnosis. */
  isEstimate?: boolean;
  /** Derived MDS-UPDRS grade 0–4, when available. */
  updrsGrade?: number;
  /** Heuristic confidence: "high" (finger tapping) | "low" (others). */
  confidence?: string;
}

/**
 * One recorded test, persisted locally in AsyncStorage. The `videoUri` points
 * at the on-device clip; nothing is actually uploaded until the real cloud
 * client lands (see lib/cloud.ts).
 */
export interface Recording {
  id: string;
  testId: TestId;
  /** Epoch millis. */
  createdAt: number;
  /** Local file URI of the captured video. */
  videoUri: string;
  status: RecordingStatus;
  /** Fake cloud job id, set once "upload" starts. */
  jobId?: string;
  /** Populated when status === 'done'. */
  result?: CloudResult;
  /** Set when status === 'failed': the raw error message, for display/debug. */
  failReason?: string;
  /** Failed and NOT worth auto/manual retrying (file gone or over size cap). */
  permanent?: boolean;
  /** Failed in the upload phase and safe to auto-resume on next launch. */
  resumable?: boolean;
}
