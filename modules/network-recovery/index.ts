import { requireOptionalNativeModule } from 'expo-modules-core';

export default requireOptionalNativeModule<{
  activate(hostname: string): Promise<boolean>;
}>('NetworkRecovery');
