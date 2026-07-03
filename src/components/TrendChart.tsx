import { Fragment, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { COLORS } from '../lib/theme';

/** One plotted point: a recording's id, its time (epoch ms), and 0–1 score. */
export interface TrendPoint {
  id: string;
  t: number;
  score: number;
}

// Fixed chart height; width is measured from the parent via onLayout. Padding
// leaves room for the y-axis labels (left) and the date labels (bottom).
const HEIGHT = 180;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;
const PAD_LEFT = 34;
const PAD_RIGHT = 14;

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Severity-over-time line chart. x = time (points sorted ascending), y = 0–1
 * score (top = 1 = more severe). Tapping a dot calls onPointPress(id). A single
 * point renders centered; two-plus points draw a connecting polyline. Ported
 * from the luche.ai observer TrialChart (recharts) — same axes + tap-to-open.
 */
export function TrendChart({
  points,
  onPointPress,
}: {
  points: TrendPoint[];
  onPointPress: (id: string) => void;
}) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Ascending by time so the line reads left→right oldest→newest.
  const data = [...points].sort((a, b) => a.t - b.t);

  const plotW = Math.max(1, width - PAD_LEFT - PAD_RIGHT);
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;

  const minT = data.length ? data[0].t : 0;
  const maxT = data.length ? data[data.length - 1].t : 1;
  const spanT = maxT - minT;

  // A lone point (or all-same-timestamp) sits centered instead of pinned left.
  const xOf = (t: number) =>
    data.length <= 1 || spanT === 0
      ? PAD_LEFT + plotW / 2
      : PAD_LEFT + ((t - minT) / spanT) * plotW;

  const yOf = (score: number) => {
    const s = Math.max(0, Math.min(1, score));
    return PAD_TOP + (1 - s) * plotH;
  };

  const polyPoints = data.map((d) => `${xOf(d.t)},${yOf(d.score)}`).join(' ');

  return (
    <View onLayout={onLayout}>
      {width > 0 && (
        <Svg width={width} height={HEIGHT}>
          {/* Horizontal gridlines + y labels at 0.0 / 0.5 / 1.0. */}
          {[0, 0.5, 1].map((g) => {
            const y = yOf(g);
            return (
              <Fragment key={`grid-${g}`}>
                <Line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={width - PAD_RIGHT}
                  y2={y}
                  stroke={COLORS.inkFaint}
                  strokeWidth={1}
                />
                <SvgText
                  x={PAD_LEFT - 6}
                  y={y + 3}
                  fontSize={10}
                  fill={COLORS.inkMuted}
                  textAnchor="end"
                >
                  {g.toFixed(1)}
                </SvgText>
              </Fragment>
            );
          })}

          {/* Connecting line (only meaningful with 2+ points). */}
          {data.length >= 2 && (
            <Polyline points={polyPoints} fill="none" stroke={COLORS.ink} strokeWidth={1.5} />
          )}

          {/* Tappable dots: a large transparent hit target + a small visible dot.
              fill="transparent" (not "none") so the hit circle still catches taps. */}
          {data.map((d) => {
            const cx = xOf(d.t);
            const cy = yOf(d.score);
            return (
              <Fragment key={d.id}>
                <Circle cx={cx} cy={cy} r={16} fill="transparent" onPress={() => onPointPress(d.id)} />
                <Circle cx={cx} cy={cy} r={4} fill={COLORS.ink} onPress={() => onPointPress(d.id)} />
              </Fragment>
            );
          })}

          {/* Date labels: first (left-anchored) and, if distinct, last (right). */}
          {data.length >= 1 && (
            <SvgText
              x={xOf(data[0].t)}
              y={HEIGHT - 8}
              fontSize={10}
              fill={COLORS.inkMuted}
              textAnchor={data.length <= 1 ? 'middle' : 'start'}
            >
              {formatDate(data[0].t)}
            </SvgText>
          )}
          {data.length >= 2 && (
            <SvgText
              x={xOf(data[data.length - 1].t)}
              y={HEIGHT - 8}
              fontSize={10}
              fill={COLORS.inkMuted}
              textAnchor="end"
            >
              {formatDate(data[data.length - 1].t)}
            </SvgText>
          )}
        </Svg>
      )}
    </View>
  );
}
