import type { EvaluatedSide, TestId } from './tests';

/**
 * Lifecycle of a recording as it moves through the local privacy stage and
 * cloud pipeline. With a privacy blur enabled this begins at `preparing`, then
 * continues through `uploading` → `processing` → `done`.
 * Mirrors the status pill shown on each results card.
 */
export type RecordingStatus =
  | 'preparing'
  | 'blur_failed'
  | 'uploading'
  | 'processing'
  | 'done'
  | 'needs_retry'
  | 'failed';

export type PrivacyBlurState =
  | 'pending'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'bypassed';

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
  /** Derived MDS-UPDRS grade 0–4 rounded to one decimal, when available. */
  updrsGrade?: number;
  /** Heuristic confidence: "high" (finger tapping) | "low" (others). */
  confidence?: string;
}

/**
 * One recorded test. Metadata is persisted in an account-scoped cache.
 * `videoUri` exists while a local clip is retained; cloud-backed history can
 * omit it and request a fresh signed URL only when the recording is opened.
 */
export interface Recording {
  id: string;
  testId: TestId;
  /** Anatomical side selected before a unilateral hand/foot/leg capture. */
  evaluatedSide?: EvaluatedSide;
  /** Epoch millis. */
  createdAt: number;
  /** Durable local file URI while the captured video is retained on-device. */
  videoUri?: string;
  /**
   * Original URI retained only across the crash-safe sanitized-file commit.
   * Upload cannot start while this field exists.
   */
  privacyBlurOriginalUri?: string;
  status: RecordingStatus;
  /** Snapshots of the device settings when the user approved this capture. */
  faceBlurRequested?: boolean;
  backgroundBlurRequested?: boolean;
  /** Durable local preprocessing state; old recordings omit it. */
  privacyBlurState?: PrivacyBlurState;
  /** In-memory local preprocessing fraction; safe to lose across a relaunch. */
  privacyBlurProgress?: number;
  /** Number of exported video frames. */
  privacyBlurFramesProcessed?: number;
  /** Number of exported frames where a face was redacted. */
  privacyBlurFramesWithFaces?: number;
  /** Number of exported frames where the background was blurred. */
  privacyBlurFramesWithBackground?: number;
  /** Number of sparse on-device pose detections used to interpolate regions. */
  privacyBlurPoseSamples?: number;
  /** Server upload intent, persisted after the video bytes reach R2. */
  uploadId?: string;
  /** In-memory upload fraction; safe to lose across a relaunch. */
  uploadProgress?: number;
  /** Current whole-file attempt; transient and shown so retries are explicit. */
  uploadAttempt?: number;
  /** True during retry backoff after an upload attempt failed. */
  uploadRetrying?: boolean;
  /** Server trial/analysis id, persisted before result polling starts. */
  jobId?: string;
  /** Populated when status === 'done'. */
  result?: CloudResult;
  /** Set when status === 'failed': the raw error message, for display/debug. */
  failReason?: string;
  /** Backend quality diagnostics when analysis completed without a score. */
  analysisFailureReasons?: string[];
  /** Failed and NOT worth auto/manual retrying (file gone or over size cap). */
  permanent?: boolean;
  /** Failed in the upload phase and safe to auto-resume on next launch. */
  resumable?: boolean;
}
