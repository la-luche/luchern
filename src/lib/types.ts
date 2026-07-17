import type { EvaluatedSide, TestId } from './tests';

/**
 * Lifecycle of a recording as it moves through the cloud
 * pipeline. `uploading` → `processing` → `done`; an unscoreable capture ends
 * at `needs_retry`, while system/upload errors end at `failed`.
 * Mirrors the status pill shown on each results card.
 */
export type RecordingStatus = 'uploading' | 'processing' | 'done' | 'needs_retry' | 'failed';

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
 * One recorded test. Metadata is persisted in AsyncStorage and `videoUri`
 * points at a durable file in the app documents directory.
 */
export interface Recording {
  id: string;
  testId: TestId;
  /** Anatomical side selected before a unilateral hand/foot/leg capture. */
  evaluatedSide?: EvaluatedSide;
  /** Epoch millis. */
  createdAt: number;
  /** Durable local file URI of the captured video. */
  videoUri: string;
  status: RecordingStatus;
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
