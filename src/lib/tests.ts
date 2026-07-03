import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type MCIName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/**
 * One MDS-UPDRS Part III item the app exposes. Ported from the Swift
 * `Evaluation` enum (yc_demo/v2/Luche/Evaluation.swift). Cloud inference means
 * the RN app drops all the per-head model-contract fields (clampRange,
 * modelInputFrames, etc.) — those now live server-side. What remains is the
 * user-facing metadata: name, UPDRS item, icon, and the instruction guide.
 */
export type TestId = 'gait' | 'arisingFromChair' | 'fingerTapping';

export interface TestConfig {
  id: TestId;
  displayName: string;
  updrsItem: string;
  icon: MCIName;
  instructionTitle: string;
  instructionSteps: string[];
}

export const TESTS: TestConfig[] = [
  {
    id: 'gait',
    displayName: 'Walking',
    updrsItem: 'MDS-UPDRS 3.10',
    icon: 'walk',
    instructionTitle: 'Walk in front of the camera',
    instructionSteps: [
      'Walk 10 steps away from the camera',
      'Turn around and walk 10 steps back',
      "Tap Start when you're ready to begin",
    ],
  },
  {
    id: 'arisingFromChair',
    displayName: 'Arising from Chair',
    updrsItem: 'MDS-UPDRS 3.9',
    icon: 'seat',
    instructionTitle: 'Stand up from a chair',
    instructionSteps: [
      'Sit in a straight-back chair',
      'Cross your arms over your chest',
      'Stand up without using your hands',
      'Repeat 3 times',
      "Tap Start when you're ready to begin",
    ],
  },
  {
    id: 'fingerTapping',
    displayName: 'Finger Tapping',
    updrsItem: 'MDS-UPDRS 3.4',
    icon: 'gesture-tap',
    instructionTitle: 'Tap your fingers',
    instructionSteps: [
      'Tap your index finger against your thumb',
      'As quickly and as widely as you can',
      'About 30 taps',
      "Tap Start when you're ready to begin",
    ],
  },
];

export function getTest(id: string | undefined): TestConfig | undefined {
  return TESTS.find((t) => t.id === id);
}
