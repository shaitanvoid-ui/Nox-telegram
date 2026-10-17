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
import "./activity-chart.css";

interface ActivityChartProps {
  data: ActivityPoint[];
}
const number = new Intl.NumberFormat("ru-RU");
const compact = new Intl.NumberFormat("ru-RU", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const tick = { fill: "#8b8b95", fontSize: 12, fontFamily: "Inter, sans-serif" };
const margin = { top: 8, right: 12, left: 0, bottom: 0 };

function displayDay(label: string) {
  const match = /^(\d{2})-(\d{2})$/.exec(label);
  if (!match) return label;
  const month = Number(match[1]),
    day = Number(match[2]);
  const date = new Date(Date.UTC(2000, month - 1, day));
  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? dateFormat.format(date)
    : label;
}

function readout(point: ActivityPoint) {
  return `${displayDay(point.label)}: сообщения — ${number.format(point.messages)}, нарушения — ${number.format(point.violations)}`;
}

/** Two independent quantities share days, while each keeps an honest, readable scale. */
export function ActivityChart({ data }: ActivityChartProps) {
  const id = useId().replace(/:/g, "");
  const [selected, setSelected] = useState<number | null>(null);
  if (!data.length)
    return (
      <div className="nd-chart nd-chart-empty">
        <span aria-hidden="true">—</span>
        <p>Пока нет данных за период</p>
        <span>Активность появится после обработки сообщений.</span>
      </div>
    );
  const index = Math.min(
    Math.max(selected ?? data.length - 1, 0),
    data.length - 1,
  );
  const current = data[index];
  const maxViolations = Math.max(3, ...data.map((point) => point.violations));
  const syncId = `nd-chart-${id}`,
    gradientId = `nd-fill-${id}`;
  function updateSelection(state: MouseHandlerDataParam) {
    if (
      state.activeTooltipIndex === null ||
      state.activeTooltipIndex === undefined
    )
      return;
    const next = Number(state.activeTooltipIndex);
    if (Number.isInteger(next) && next >= 0 && next < data.length)
      setSelected(next);
  }
  return (
    <div className="nd-chart">
      <div className="nd-chart-readout">
        <div className="nd-chart-metric">
          <span>
            <i className="nd-chart-dot" aria-hidden="true" />
            Сообщения
          </span>
          <strong>{number.format(current.messages)}</strong>
        </div>
        <div className="nd-chart-metric nd-chart-metric-secondary">
          <span>
            <i className="nd-chart-dot nd-chart-dot-amber" aria-hidden="true" />
            Нарушения
          </span>
          <strong>{number.format(current.violations)}</strong>
        </div>
        <span className="nd-chart-date">{displayDay(current.label)}</span>
      </div>
      <div className="nd-chart-track-heading">
        <span>Сообщения в день</span>
        <span>сообщения</span>
      </div>
      <div className="nd-chart-messages" aria-hidden="true">
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
                <stop offset="0%" stopColor="#a292ff" stopOpacity={0.22} />
                <stop offset="100%" stopColor="#a292ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="rgba(255,255,255,.075)"
              strokeDasharray="2 6"
            />
            <XAxis dataKey="label" scale="band" hide />
            <YAxis
              width={56}
              tick={tick}
              tickLine={false}
              axisLine={false}
              tickCount={4}
              allowDecimals={false}
              domain={[0, "auto"]}
              tickFormatter={(value) => compact.format(Number(value))}
            />
            <Tooltip content={() => null} cursor={false} />
            <ReferenceLine
              x={current.label}
              stroke="#d0c9ff"
              strokeOpacity={0.4}
              strokeDasharray="3 5"
            />
            <Area
              dataKey="messages"
              name="Сообщения"
              type="monotone"
              stroke="#b8aaff"
              strokeWidth={2.5}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
              dot={data.length === 1 ? { fill: "#b8aaff", r: 4 } : false}
              activeDot={{ r: 4, stroke: "#111114", strokeWidth: 3 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="nd-chart-track-heading nd-chart-track-heading-secondary">
        <span>Нарушения в день</span>
        <span>своя шкала: 0–{number.format(maxViolations)}</span>
      </div>
      <div className="nd-chart-violations" aria-hidden="true">
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
              stroke="rgba(255,255,255,.075)"
              strokeDasharray="2 6"
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
              width={56}
              tick={tick}
              tickLine={false}
              axisLine={false}
              domain={[0, maxViolations]}
              ticks={[0, Math.ceil(maxViolations / 2), maxViolations]}
              allowDecimals={false}
            />
            <Tooltip content={() => null} cursor={false} />
            <ReferenceLine
              x={current.label}
              stroke="#b8aaff"
              strokeOpacity={0.25}
              strokeDasharray="3 5"
            />
            <Bar
              dataKey="violations"
              name="Нарушения"
              fill="#d9ad79"
              fillOpacity={0.9}
              radius={[3, 3, 0, 0]}
              maxBarSize={12}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="nd-chart-scrubber">
        <label htmlFor={`nd-day-${id}`}>День на графике</label>
        <input
          id={`nd-day-${id}`}
          type="range"
          min={0}
          max={data.length - 1}
          step={1}
          value={index}
          disabled={data.length === 1}
          aria-valuetext={readout(current)}
          onChange={(event) => setSelected(Number(event.target.value))}
        />
        <output htmlFor={`nd-day-${id}`}>
          {index + 1} / {data.length}
        </output>
      </div>
      <table className="sr-only">
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
