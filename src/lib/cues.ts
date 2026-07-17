import * as Haptics from 'expo-haptics';

/**
 * Haptic-only cues for the capture flow. Spoken/TTS cues are intentionally
 * disabled; the on-screen instructions remain the source of capture guidance.
 * Everything is best-effort so missing haptics never break recording.
 */

function buzz(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // haptics unavailable — ignore
  }
}

export const cues = {
  /** Recording actually started → strong buzz. */
  start(_text: string): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** End tapped → recording stopping. */
  stop(_text: string): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
  /** Clip submitted → a quiet success buzz (no speech; a toast carries the text). */
  saved(): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
};
