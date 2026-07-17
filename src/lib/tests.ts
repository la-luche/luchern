import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * One MDS-UPDRS Part III item the app exposes. Structural fields only —
 * user-facing copy (name / instruction title / steps) lives in the i18n
 * dictionaries (src/lib/i18n), keyed by TestId. `updrsItem` is the same across
 * languages, so it stays here.
 */
export type TestId =
  | 'fingerTapping'
  | 'handMovements'
  | 'pronationSupination'
  | 'toeTapping'
  | 'legAgility'
  | 'arisingFromChair'
  | 'gait'
  | 'restTremor';

export interface TestConfig {
  id: TestId;
  updrsItem: string;
  icon: MCIName;
  /**
   * Looping demo clip shown on the instruction screen. require()'d mp4 in
   * assets/demos/. Optional — tests without a filmed demo yet show an icon
   * placeholder instead.
   */
  demoVideo?: number;
  /** First-frame image shown instantly while the demo video loads. */
  demoPoster?: number;
}

// Ordered by MDS-UPDRS item number.
export const TESTS: TestConfig[] = [
  {
    id: 'fingerTapping',
    updrsItem: 'MDS-UPDRS 3.4',
    icon: 'gesture-tap',
    demoVideo: require('../../assets/demos/FingerTappingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/FingerTappingDemo.jpg'),
  },
  {
    id: 'handMovements',
    updrsItem: 'MDS-UPDRS 3.5',
    icon: 'hand-back-right',
    demoVideo: require('../../assets/demos/HandMovementsDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/HandMovementsDemo.jpg'),
  },
  {
    id: 'pronationSupination',
    updrsItem: 'MDS-UPDRS 3.6',
    icon: 'rotate-3d-variant',
    demoVideo: require('../../assets/demos/HandTurnsDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/HandTurnsDemo.jpg'),
  },
  {
    id: 'toeTapping',
    updrsItem: 'MDS-UPDRS 3.7',
    icon: 'foot-print',
    demoVideo: require('../../assets/demos/ToeTappingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/ToeTappingDemo.jpg'),
  },
  {
    id: 'legAgility',
    updrsItem: 'MDS-UPDRS 3.8',
    icon: 'shoe-print',
    demoVideo: require('../../assets/demos/LegAgilityDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/LegAgilityDemo.jpg'),
  },
  {
    id: 'arisingFromChair',
    updrsItem: 'MDS-UPDRS 3.9',
    icon: 'seat',
    demoVideo: require('../../assets/demos/ChairDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/ChairDemo.jpg'),
  },
  {
    id: 'gait',
    updrsItem: 'MDS-UPDRS 3.10',
    icon: 'walk',
    demoVideo: require('../../assets/demos/WalkingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/WalkingDemo.jpg'),
  },
  {
    id: 'restTremor',
    updrsItem: 'MDS-UPDRS 3.17',
    icon: 'vibrate',
    demoVideo: require('../../assets/demos/RestTremorDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/RestTremorDemo.jpg'),
  },
];

export function getTest(id: string | undefined): TestConfig | undefined {
  return TESTS.find((t) => t.id === id);
}
