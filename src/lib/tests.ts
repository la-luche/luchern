import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * One MDS-UPDRS Part III item the app exposes. Structural fields only —
 * user-facing copy (name / instruction title / steps) lives in the i18n
 * dictionaries (src/lib/i18n), keyed by TestId. `updrsItem` is the same across
 * languages, so it stays here.
 */
export type TestId = 'gait' | 'arisingFromChair' | 'fingerTapping';

export interface TestConfig {
  id: TestId;
  updrsItem: string;
  icon: MCIName;
  /** Looping demo clip shown on the instruction screen. require()'d mp4 in assets/demos/. */
  demoVideo: number;
}

export const TESTS: TestConfig[] = [
  {
    id: 'gait',
    updrsItem: 'MDS-UPDRS 3.10',
    icon: 'walk',
    demoVideo: require('../../assets/demos/WalkingDemo.mp4'),
  },
  {
    id: 'arisingFromChair',
    updrsItem: 'MDS-UPDRS 3.9',
    icon: 'seat',
    demoVideo: require('../../assets/demos/ChairDemo.mp4'),
  },
  {
    id: 'fingerTapping',
    updrsItem: 'MDS-UPDRS 3.4',
    icon: 'gesture-tap',
    demoVideo: require('../../assets/demos/FingerTappingDemo.mp4'),
  },
];

export function getTest(id: string | undefined): TestConfig | undefined {
  return TESTS.find((t) => t.id === id);
}
