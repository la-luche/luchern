import { NativeModule, requireOptionalNativeModule } from 'expo-modules-core';

export type BackgroundMode = 'continued' | 'limited' | 'unavailable';
type Events = {
  onTick(event: { sessionId: string }): void;
  onExpired(event: { sessionId: string }): void;
  onModeChanged(event: { sessionId: string; mode: BackgroundMode }): void;
};
declare class BackgroundWorkNative extends NativeModule<Events> {
  beginAsync(sessionId: string, title: string, subtitle: string): Promise<BackgroundMode>;
  updateAsync(sessionId: string, title: string, subtitle: string, progress: number): Promise<void>;
  endAsync(sessionId: string, success: boolean): Promise<void>;
}
// Environments without this native module cannot acquire a background lease.
export const backgroundWork = requireOptionalNativeModule<BackgroundWorkNative>('BackgroundWork');
