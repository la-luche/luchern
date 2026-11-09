import { afterEach, expect, it } from '@jest/globals';
const React = require('react');
const { act, create } = require('react-test-renderer');
const { Circle, Text: SvgText } = require('react-native-svg');
const { TrendChart } = require('../../components/TrendChart');
let screen;
afterEach(() => { if (screen) act(() => screen.unmount()); });
it.each([1, 4])('places a halfway score halfway up the %s-point scale', (maxScore) => {
  act(() => { screen = create(React.createElement(TrendChart, {
    points: [{ id: 'point', t: 1, score: maxScore / 2 }], maxScore,
  })); });
  const layout = screen.root.findAll(node => typeof node.props.onLayout === 'function')[0];
  act(() => layout.props.onLayout({ nativeEvent: { layout: { width: 320 } } }));
  expect(screen.root.findAllByType(SvgText).slice(0, 3).map(node => node.props.children)).toEqual(['0.0', (maxScore / 2).toFixed(1), maxScore.toFixed(1)]);
  const dot = screen.root.findAllByType(Circle).find(node => node.props.r === 4);
  expect(dot.props.cy).toBe(84);
});
