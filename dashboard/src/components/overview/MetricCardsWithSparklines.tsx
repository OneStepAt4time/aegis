/**
 * components/overview/MetricCardsWithSparklines.tsx — Enhanced metric cards with 7-day sparklines.
 * Example integration showing how to use SparklineCard for overview stats.
 */

import { SparklineCard } from '../shared/SparklineCard';

// Generate mock 7-day trend data
function generateMockTrendData(baseValue: number, variance: number = 0.2): Array<{ day: string; value: number }> {
  const data = [];
  const today = new Date();
  
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dayLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    // Random variation around base value
    const value = baseValue * (1 + (Math.random() - 0.5) * variance);
    
    data.push({
      day: dayLabel,
      value: parseFloat(value.toFixed(2)),
    });
  }
  
  return data;
}

interface MetricCardsWithSparklinesProps {
  activeSessionsCount?: number;
  completedSessionsCount?: number;
  avgDailyCost?: number;
  totalMessages?: number;
}

export function MetricCardsWithSparklines({
  activeSessionsCount = 0,
  completedSessionsCount = 0,
  avgDailyCost = 0,
  totalMessages = 0,
}: MetricCardsWithSparklinesProps) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      {activeSessionsCount > 0 && (
        <SparklineCard
          label="Active Sessions"
          value={activeSessionsCount}
          data={generateMockTrendData(activeSessionsCount, 0.3)}
          color="var(--color-accent-cyan)"
        />
      )}
      
      {completedSessionsCount > 0 && (
        <SparklineCard
          label="Completed (7d)"
          value={completedSessionsCount}
          data={generateMockTrendData(completedSessionsCount / 7, 0.4)}
          color="var(--color-success)"
        />
      )}
      
      {avgDailyCost > 0 && (
        <SparklineCard
          label="Avg Daily Cost"
          value={`$${avgDailyCost.toFixed(2)}`}
          data={generateMockTrendData(avgDailyCost, 0.25)}
          color="var(--color-warning)"
        />
      )}
      
      {totalMessages > 0 && (
        <SparklineCard
          label="Messages (7d)"
          value={totalMessages}
          data={generateMockTrendData(totalMessages / 7, 0.35)}
          color="var(--color-accent-purple)"
        />
      )}
    </div>
  );
}
