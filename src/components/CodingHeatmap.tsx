"use client";

import { useMemo, useRef, useState, useCallback, Fragment } from "react";
import { Activity } from "lucide-react";

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Level 0 uses Tailwind class for theme-awareness; levels 1-4 use rgba (auto-adapts to any bg)
const LEVEL_BG: (string | undefined)[] = [
  undefined, // level 0 → className="bg-bg-input"
  "rgba(255, 105, 51, 0.2)",
  "rgba(255, 105, 51, 0.4)",
  "rgba(255, 105, 51, 0.65)",
  "rgba(255, 105, 51, 0.9)",
];

interface HeatmapDay {
  date: string;
  count: number;
  conversations: number;
  level: 0 | 1 | 2 | 3 | 4;
}

interface WeekColumn {
  days: (HeatmapDay | null)[];
}

interface MonthLabel {
  label: string;
  col: number; // grid column index (0-based week index)
  span: number;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// FIXME: 每个 cell 都带独立 title 字符串 + inline style，~365 个 DOM 节点，
// buildGrid 在 data 变化时 O(days) 重算 + React reconciliation 开销明显。
// 后续考虑：虚拟化 / canvas 渲染 / 将 tooltip 改为单个浮层按需定位。
function buildGrid(
  from: string,
  to: string,
  data: Record<string, { totalMessages: number; totalConversations?: number }>,
) {
  const startDate = new Date(from + "T00:00:00");
  const endDate = new Date(to + "T00:00:00");

  const gridStart = new Date(startDate);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());

  const nonZero = Object.values(data)
    .map((d) => d.totalMessages)
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const p25 = nonZero[Math.floor(nonZero.length * 0.25)] || 1;
  const p50 = nonZero[Math.floor(nonZero.length * 0.5)] || 2;
  const p75 = nonZero[Math.floor(nonZero.length * 0.75)] || 3;

  function getLevel(count: number): 0 | 1 | 2 | 3 | 4 {
    if (count === 0) return 0;
    if (count <= p25) return 1;
    if (count <= p50) return 2;
    if (count <= p75) return 3;
    return 4;
  }

  const weeks: WeekColumn[] = [];
  const weekMonths: number[] = [];
  const current = new Date(gridStart);

  while (current <= endDate) {
    const days: (HeatmapDay | null)[] = [];
    let weekMonth = current.getMonth();

    for (let dow = 0; dow < 7; dow++) {
      const inRange = current >= startDate && current <= endDate;
      if (inRange) {
        if (dow === 0 || days.every((d) => d === null))
          weekMonth = current.getMonth();
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, "0");
        const d = String(current.getDate()).padStart(2, "0");
        const dateStr = `${y}-${m}-${d}`;
        const count = data[dateStr]?.totalMessages || 0;
        const conversations = data[dateStr]?.totalConversations || 0;
        days.push({ date: dateStr, count, conversations, level: getLevel(count) });
      } else {
        days.push(null);
      }
      current.setDate(current.getDate() + 1);
    }

    weeks.push({ days });
    weekMonths.push(weekMonth);
  }

  // Build month labels with position and span
  const monthLabels: MonthLabel[] = [];
  let i = 0;
  while (i < weekMonths.length) {
    const month = weekMonths[i];
    const col = i;
    let span = 0;
    while (i < weekMonths.length && weekMonths[i] === month) {
      span++;
      i++;
    }
    monthLabels.push({ label: MONTH_LABELS[month], col, span });
  }

  return { weeks, monthLabels };
}

interface CodingHeatmapProps {
  data: Record<string, { totalMessages: number; totalConversations?: number }>;
  from: string;
  to: string;
  loading?: boolean;
}

export function CodingHeatmap({ data, from, to, loading }: CodingHeatmapProps) {
  const { weeks, monthLabels } = useMemo(
    () => buildGrid(from, to, data),
    [from, to, data],
  );

  const totalMessages = useMemo(
    () => Object.values(data).reduce((sum, d) => sum + d.totalMessages, 0),
    [data],
  );

  const activeDays = useMemo(
    () => Object.values(data).filter((d) => d.totalMessages > 0).length,
    [data],
  );

  // Custom tooltip state — single shared floating div, positioned on hover
  const gridRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  const handleCellEnter = useCallback((e: React.MouseEvent, day: HeatmapDay) => {
    const grid = gridRef.current;
    if (!grid) return;
    const cell = e.currentTarget.getBoundingClientRect();
    const gridRect = grid.getBoundingClientRect();
    const d = new Date(day.date + "T00:00:00");
    const text = day.count > 0
      ? `${day.count.toLocaleString()} messages on ${MONTH_NAMES[d.getMonth()]} ${ordinal(d.getDate())}`
      : `No messages on ${MONTH_NAMES[d.getMonth()]} ${ordinal(d.getDate())}`;
    setTooltip({
      text,
      x: cell.left + cell.width / 2 - gridRect.left,
      y: cell.top - gridRect.top,
    });
  }, []);

  const handleCellLeave = useCallback(() => setTooltip(null), []);

  if (loading) {
    return (
      <div className="bg-bg-card border border-border rounded-lg p-5 mb-8">
        <div className="h-4 w-32 bg-bg-input rounded mb-4 animate-pulse" />
        <div className="h-22.5 bg-bg-input rounded animate-pulse" />
      </div>
    );
  }

  const cols = weeks.length;
  const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

  return (
    <div className="bg-bg-card border border-border rounded-lg p-5 mb-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Coding Activity
        </h2>
        <div className="flex items-center gap-3 text-xs text-text-dim">
          <span>{totalMessages.toLocaleString()} messages</span>
          <span>{activeDays} active days</span>
        </div>
      </div>

      {/* CSS Grid heatmap — fills container width */}
      <div
        ref={gridRef}
        className="heatmap-grid relative"
        style={{
          display: "grid",
          gridTemplateColumns: `26px repeat(${cols}, 1fr)`,
          gridTemplateRows: `14px repeat(7, 1fr)`,
          gap: 3,
        }}
      >
        {/* Row 0: month labels */}
        <div /> {/* empty label cell */}
        {monthLabels.map((m, i) => (
          <div
            key={i}
            className="text-[10px] text-text-dim leading-none truncate"
            style={{
              gridColumn: `${m.col + 2} / span ${m.span}`,
            }}
          >
            {m.span >= 2 ? m.label : ""}
          </div>
        ))}
        {/* Rows 1-7: day-of-week label + cells */}
        {DAY_LABELS.map((label, dow) => (
          <Fragment key={dow}>
            <div className="text-[10px] text-text-dim flex items-center justify-end pr-1 leading-none">
              {label}
            </div>
            {weeks.map((week, wi) => {
              const day = week.days[dow];
              if (!day) {
                return <div key={wi} />;
              }
              return (
                <div
                  key={wi}
                  className={`rounded-sm aspect-square ${day.level === 0 ? "bg-bg-input" : ""} heatmap-cell`}
                  style={
                    day.level > 0
                      ? { backgroundColor: LEVEL_BG[day.level] }
                      : undefined
                  }
                  onMouseEnter={(e) => handleCellEnter(e, day)}
                  onMouseLeave={handleCellLeave}
                />
              );
            })}
          </Fragment>
        ))}

        {/* Custom tooltip */}
        {tooltip && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="bg-[#1b1f23] text-white text-xs px-2.5 py-1.5 rounded-md whitespace-nowrap mb-1 shadow-lg">
              {tooltip.text}
            </div>
            <div
              className="w-0 h-0 mx-auto"
              style={{
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "5px solid #1b1f23",
                marginTop: -4,
              }}
            />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5 mt-3 text-[10px] text-text-dim">
        <span>Less</span>
        {LEVEL_BG.map((bg, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-xs ${i === 0 ? "bg-bg-input" : ""}`}
            style={i > 0 ? { backgroundColor: bg } : undefined}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
