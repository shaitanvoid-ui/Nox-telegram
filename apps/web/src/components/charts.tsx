import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatNumber } from "../api";
import "../styles/advanced-pages.css";
export { ActivityChart } from "./dashboard/ActivityChart";

function dateLabel(value: string) {
  const label = /^\d{2}-\d{2}$/.test(value) ? `2000-${value}` : value;
  const date = new Date(`${label}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("ru", { day: "numeric", month: "short" }).format(
        date,
      );
}
export function GrowthChart({
  data,
}: {
  data: { label: string; members: number }[];
}) {
  const axis = {
    fill: "#a4a4ae",
    fontSize: 12,
    fontFamily: "Inter, sans-serif",
  };
  return (
    <div className="ap-growth-chart">
      <div
        className="ap-growth-chart-canvas"
        role="img"
        aria-label="Количество участников по дням. Те же данные доступны в таблице ниже."
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 12, right: 12, left: 0, bottom: 12 }}
          >
            <CartesianGrid vertical={false} stroke="#ffffff10" />
            <XAxis
              dataKey="label"
              tickFormatter={dateLabel}
              tick={axis}
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              dy={10}
            />
            <YAxis
              tick={axis}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(value: number) =>
                new Intl.NumberFormat("ru", { notation: "compact" }).format(
                  value,
                )
              }
            />
            <Tooltip
              contentStyle={{
                background: "#19191c",
                border: "1px solid #ffffff24",
                borderRadius: 16,
                color: "#f5f5f7",
                fontSize: 13,
                padding: "12px 16px",
              }}
              labelFormatter={(label) => dateLabel(String(label))}
              formatter={(value) => [formatNumber(Number(value)), "Участники"]}
              cursor={{ fill: "#ffffff06" }}
            />
            <Bar
              name="Участники"
              dataKey="members"
              fill="#a597ff"
              radius={[4, 4, 0, 0]}
              maxBarSize={34}
              isAnimationActive={false}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="ap-data-table">
        <summary>Данные графика</summary>
        <table>
          <caption className="sr-only">Количество участников по дням</caption>
          <thead>
            <tr>
              <th scope="col">Дата</th>
              <th scope="col">Участники</th>
            </tr>
          </thead>
          <tbody>
            {data.map((item) => (
              <tr key={item.label}>
                <th scope="row">{dateLabel(item.label)}</th>
                <td>{formatNumber(item.members)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
