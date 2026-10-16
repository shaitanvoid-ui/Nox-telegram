import { useId, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MouseHandlerDataParam } from "recharts";
import type { ActivityPoint } from "../../types";
import "./nox-dashboard.css";

interface ActivityChartProps {
  data: ActivityPoint[];
}

const number = new Intl.NumberFormat("ru-RU");
const compactNumber = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const tick = { fill: "#929CB2", fontSize: 12, fontFamily: "Inter, sans-serif" };
const margin = { top: 8, right: 10, left: 0, bottom: 0 };
const dayMonth = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

function displayDay(label: string) {
  const match = /^(\d{2})-(\d{2})$/.exec(label);
  if (!match) return label;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return label;
  return dayMonth.format(date);
}

function readout(point: ActivityPoint) {
  return `${displayDay(point.label)}: сообщения — ${number.format(point.messages)}, нарушения — ${number.format(point.violations)}`;
}

/** Shared days, independent scales: a few violations stay visible next to thousands of messages. */
export function ActivityChart({ data }: ActivityChartProps) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);

  if (!data.length) {
    return (
      <div className="nox-chart-theme nox-chart-empty">
        <span className="nox-chart-empty-mark" aria-hidden="true">
          —
        </span>
        <p>Пока нет данных за период</p>
        <span>Активность появится после обработки сообщений.</span>
      </div>
    );
  }

  const index = Math.min(
    Math.max(selected ?? data.length - 1, 0),
    data.length - 1,
  );
  const current = data[index];
  const maxViolations = Math.max(3, ...data.map((point) => point.violations));
  const syncId = `nox-activity-${id}`;
  const gradientId = `nox-activity-fill-${id}`;
  const updateSelection = (state: MouseHandlerDataParam) => {
    if (
      state.activeTooltipIndex === null ||
      state.activeTooltipIndex === undefined
    )
      return;
    const next = Number(state.activeTooltipIndex);
    if (Number.isInteger(next) && next >= 0 && next < data.length)
      setSelected(next);
  };

  return (
    <div className="nox-chart-theme nox-activity-chart">
      <div className="nox-chart-readout">
        <span className="nox-chart-date">{displayDay(current.label)}</span>
        <span className="nox-chart-value">
          <i
            className="nox-data-dot nox-data-dot--messages"
            aria-hidden="true"
          />
          <strong>{number.format(current.messages)}</strong>
          <span>сообщений</span>
        </span>
        <span className="nox-chart-value">
          <i
            className="nox-data-dot nox-data-dot--violations"
            aria-hidden="true"
          />
          <strong>{number.format(current.violations)}</strong>
          <span>нарушений</span>
        </span>
      </div>

      <div className="nox-chart-lane-label">
        <span>Сообщения в день</span>
        <span>сообщения</span>
      </div>
      <div className="nox-message-lane" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={data}
            syncId={syncId}
            margin={margin}
            onMouseMove={updateSelection}
            onClick={updateSelection}
            onTouchMove={updateSelection}
            accessibilityLayer={false}
          >
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#8585FF" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#8585FF" stopOpacity={0.015} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="rgba(146,156,178,.13)"
              strokeDasharray="3 5"
            />
            <XAxis dataKey="label" scale="band" hide />
            <YAxis
              width={64}
              tick={tick}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              allowDecimals={false}
              domain={[0, "auto"]}
              tickFormatter={(value) => compactNumber.format(Number(value))}
            />
            <Tooltip
              content={() => null}
              cursor={{
                stroke: "#8585FF",
                strokeOpacity: 0.45,
                strokeDasharray: "3 4",
              }}
            />
            <ReferenceLine
              x={current.label}
              stroke="#8585FF"
              strokeOpacity={0.55}
              strokeDasharray="3 4"
            />
            <Area
              name="Сообщения"
              dataKey="messages"
              type="monotone"
              stroke="#A2A0FF"
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={data.length === 1 ? { fill: "#A2A0FF", r: 4 } : false}
              activeDot={{ r: 4, stroke: "#111520", strokeWidth: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="nox-chart-lane-label nox-chart-lane-label--violations">
        <span>
          <i
            className="nox-data-dot nox-data-dot--violations"
            aria-hidden="true"
          />
          Нарушения в день
        </span>
        <span>своя шкала: 0–{number.format(maxViolations)}</span>
      </div>
      <div className="nox-violation-lane" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
          <ComposedChart
            data={data}
            syncId={syncId}
            margin={margin}
            onMouseMove={updateSelection}
            onClick={updateSelection}
            onTouchMove={updateSelection}
            accessibilityLayer={false}
          >
            <CartesianGrid
              vertical={false}
              stroke="rgba(146,156,178,.13)"
              strokeDasharray="3 5"
            />
            <XAxis
              dataKey="label"
              scale="band"
              tickFormatter={(value) => displayDay(String(value))}
              tick={tick}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={28}
              height={32}
              dy={9}
            />
            <YAxis
              width={64}
              tick={tick}
              tickLine={false}
              axisLine={false}
              domain={[0, maxViolations]}
              ticks={[0, Math.ceil(maxViolations / 2), maxViolations]}
              allowDecimals={false}
            />
            <Tooltip
              content={() => null}
              cursor={{ fill: "#F5B454", fillOpacity: 0.06 }}
            />
            <ReferenceLine
              x={current.label}
              stroke="#F5B454"
              strokeOpacity={0.55}
              strokeDasharray="3 4"
            />
            <Bar
              name="Нарушения"
              dataKey="violations"
              fill="#F5B454"
              fillOpacity={0.8}
              radius={[3, 3, 0, 0]}
              maxBarSize={20}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="nox-chart-scrubber">
        <label htmlFor={`nox-day-${id}`}>День на графике</label>
        <input
          id={`nox-day-${id}`}
          type="range"
          min={0}
          max={data.length - 1}
          step={1}
          value={index}
          disabled={data.length === 1}
          aria-valuetext={readout(current)}
          onChange={(event) => setSelected(Number(event.target.value))}
        />
        <output htmlFor={`nox-day-${id}`}>
          {index + 1} / {data.length}
        </output>
      </div>

      <table className="nox-screen-reader-only">
        <caption>Сообщения и нарушения по дням</caption>
        <thead>
          <tr>
            <th scope="col">День</th>
            <th scope="col">Сообщения</th>
            <th scope="col">Нарушения</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point, pointIndex) => (
            <tr key={`${point.label}-${pointIndex}`}>
              <th scope="row">{displayDay(point.label)}</th>
              <td>{number.format(point.messages)}</td>
              <td>{number.format(point.violations)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
