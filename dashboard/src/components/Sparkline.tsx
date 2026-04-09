/**
 * components/Sparkline.tsx — Tiny inline SVG bar chart for data trends.
 */

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}

export default function Sparkline({
  data,
  width = 60,
  height = 24,
  color = '#00e5ff',
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeOpacity={0.3}
          strokeWidth={1}
        />
      </svg>
    );
  }

  const max = Math.max(...data);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const barWidth = Math.max(1, width / data.length - 1);
  const gap = (width - barWidth * data.length) / (data.length + 1);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {data.map((value, i) => {
        const normalized = (value - min) / range;
        const barHeight = Math.max(1, normalized * (height - 2));
        const x = gap + i * (barWidth + gap);
        const y = height - barHeight - 1;
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            fill={color}
            opacity={0.8}
            rx={1}
          />
        );
      })}
    </svg>
  );
}
