const React = require('react');
const { act, create } = require('react-test-renderer');
const { AccessibilityInfo } = require('react-native');
const { DemoVideoProvider } = require('../../components/DemoVideoProvider');
const { DemoVideo } = require('../../components/Instruction');

const mockPlayers = [];
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('../tests', () => ({ TESTS: [{ demoVideo: 1 }, { demoVideo: 2 }] }));
jest.mock('expo-video', () => ({
  VideoView: () => null,
  createVideoPlayer: () => {
    let released = false;
    const alive = () => {
      if (released) throw new Error('Cannot use shared object that was already released');
    };
    const player = {
      play: jest.fn(alive),
      pause: jest.fn(alive),
      release: jest.fn(() => { alive(); released = true; }),
    };
    mockPlayers.push(player);
    return player;
  },
}));

let screen;
function tree(visible = true, key = 'session') {
  return React.createElement(DemoVideoProvider, { key }, visible
    ? React.createElement(DemoVideo, { source: 1, icon: 'hand-back-right', caption: 'Demo' })
    : null);
}
beforeEach(() => {
  mockPlayers.length = 0;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
});
afterEach(() => {
  if (screen) act(() => screen.unmount());
  screen = undefined;
  jest.restoreAllMocks();
});

it('can leave and reopen instructions without releasing the cached demo', async () => {
  await act(async () => { screen = create(tree()); });
  const player = mockPlayers[0];
  expect(player.play).toHaveBeenCalledTimes(1);
  await act(async () => screen.update(tree(false)));
  expect(player.pause).toHaveBeenCalledTimes(1);
  expect(player.release).not.toHaveBeenCalled();
  await act(async () => screen.update(tree()));
  expect(player.play).toHaveBeenCalledTimes(2);
});

it('can tear down the app tree while an instruction demo is mounted', async () => {
  await act(async () => { screen = create(tree()); });
  const previous = screen;
  screen = undefined;
  expect(() => act(() => previous.unmount())).not.toThrow();
  for (const player of mockPlayers) expect(player.release).toHaveBeenCalledTimes(1);
});

it('can replace the authenticated app tree without calling released players', async () => {
  await act(async () => { screen = create(tree()); });
  const oldPlayer = mockPlayers[0];
  await act(async () => screen.update(tree(true, 'new-session')));
  expect(oldPlayer.release).toHaveBeenCalledTimes(1);
  expect(mockPlayers[2].play).toHaveBeenCalledTimes(1);
});
