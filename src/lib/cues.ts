import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';

/**
 * Audio + haptic cues for the capture flow. Designed for the actual patient:
 * during the gait test they walk *away* from the phone and can't watch it, so
 * the meaningful transitions are spoken aloud (they hear it) while the phone
 * buzzes (the helper holding it feels it). Everything is best-effort — a missing
 * module or a TTS hiccup must never break recording.
 *
 * Speech is slightly slowed for older listeners. No bundled audio assets: TTS +
 * haptics only, so it runs in Expo Go.
 */

function buzz(run: () => Promise<unknown>): void {
  try {
    void run().catch(() => {});
  } catch {
    // haptics unavailable — ignore
  }
}

function say(text: string): void {
  try {
    Speech.stop(); // avoid overlap if cues fire close together
    Speech.speak(text, { rate: 0.9 });
  } catch {
    // speech unavailable — ignore
  }
}

export const cues = {
  /** Recording actually started → strong buzz + spoken action ("Start walking"). */
  start(text: string): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    say(text);
  },
  /** End tapped → recording stopping. */
  stop(text: string): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    say(text);
  },
  /** Clip submitted → a quiet success buzz (no speech; a toast carries the text). */
  saved(): void {
    buzz(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  },
};
