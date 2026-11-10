import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import type { DemoFraming } from './demoFraming';

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

export type EvaluatedSide = 'left' | 'right';

export interface TestConfig {
  id: TestId;
  updrsItem: string;
  icon: MCIName;
  /** The backend must know which anatomical limb the patient was instructed to use. */
  sideSpecific?: boolean;
  /** User-facing anatomical noun used to disambiguate left/right guided steps. */
  sideLimb?: 'hand' | 'leg';
  /**
   * Looping demo clip shown on the instruction screen. require()'d mp4 in
   * assets/demos/. Optional — full-screen guides without a filmed demo show a
   * black TBD placeholder instead.
   */
  demoVideo?: number;
  /** First-frame image shown instantly while the demo video loads. */
  demoPoster?: number;
  /** Per-demo crop used by the full-screen instruction guide. */
  demoFraming?: DemoFraming;
}

// Ordered by MDS-UPDRS item number.
export const TESTS: TestConfig[] = [
  {
    id: 'fingerTapping',
    updrsItem: 'MDS-UPDRS 3.4',
    icon: 'gesture-tap',
    sideSpecific: true,
    sideLimb: 'hand',
    demoVideo: require('../../assets/demos/FingerTappingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/FingerTappingDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: -0.08 },
  },
  {
    id: 'handMovements',
    updrsItem: 'MDS-UPDRS 3.5',
    icon: 'hand-back-right',
    sideSpecific: true,
    sideLimb: 'hand',
    demoVideo: require('../../assets/demos/HandMovementsDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/HandMovementsDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: 0 },
  },
  {
    id: 'pronationSupination',
    updrsItem: 'MDS-UPDRS 3.6',
    icon: 'rotate-3d-variant',
    sideSpecific: true,
    sideLimb: 'hand',
    demoVideo: require('../../assets/demos/HandTurnsDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/HandTurnsDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: -0.09 },
  },
  {
    id: 'toeTapping',
    updrsItem: 'MDS-UPDRS 3.7',
    icon: 'foot-print',
    sideSpecific: true,
    sideLimb: 'leg',
    demoVideo: require('../../assets/demos/ToeTappingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/ToeTappingDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: -0.18 },
  },
  {
    id: 'legAgility',
    updrsItem: 'MDS-UPDRS 3.8',
    icon: 'shoe-print',
    sideSpecific: true,
    sideLimb: 'leg',
    demoVideo: require('../../assets/demos/LegAgilityDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/LegAgilityDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: -0.22 },
  },
  {
    id: 'arisingFromChair',
    updrsItem: 'MDS-UPDRS 3.9',
    icon: 'seat',
    demoVideo: require('../../assets/demos/ChairDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/ChairDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: 0 },
  },
  {
    id: 'gait',
    updrsItem: 'MDS-UPDRS 3.10',
    icon: 'walk',
    demoVideo: require('../../assets/demos/WalkingDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/WalkingDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: 0 },
  },
  {
    id: 'restTremor',
    updrsItem: 'MDS-UPDRS 3.17',
    icon: 'vibrate',
    demoVideo: require('../../assets/demos/RestTremorDemo.mp4'),
    demoPoster: require('../../assets/demos/posters/RestTremorDemo.jpg'),
    demoFraming: { scale: 1, x: 0, y: -0.15 },
  },
];

export interface FullTestStep {
  testId: TestId;
  evaluatedSide?: EvaluatedSide;
}

/**
 * Guided full check. Unilateral movements are recorded left then right before
 * advancing; the non-lateralized tremor check follows the hand tests.
 */
export const FULL_TEST_FLOW: readonly FullTestStep[] = [
  { testId: 'fingerTapping', evaluatedSide: 'left' },
  { testId: 'fingerTapping', evaluatedSide: 'right' },
  { testId: 'pronationSupination', evaluatedSide: 'left' },
  { testId: 'pronationSupination', evaluatedSide: 'right' },
  { testId: 'handMovements', evaluatedSide: 'left' },
  { testId: 'handMovements', evaluatedSide: 'right' },
  { testId: 'restTremor' },
  { testId: 'toeTapping', evaluatedSide: 'left' },
  { testId: 'toeTapping', evaluatedSide: 'right' },
  { testId: 'legAgility', evaluatedSide: 'left' },
  { testId: 'legAgility', evaluatedSide: 'right' },
  { testId: 'arisingFromChair' },
  { testId: 'gait' },
];

export function getTest(id: string | undefined): TestConfig | undefined {
  return TESTS.find((t) => t.id === id);
}
