import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
const axis = { fill: "#7d879d", fontSize: 11, fontFamily: "Inter" };
const tooltip = {
  backgroundColor: "#181e2b",
  border: "1px solid #30394e",
  borderRadius: 12,
  color: "#f5f7ff",
  fontSize: 12,
  padding: "12px 16px",
};
export { ActivityChart } from "./dashboard/ActivityChart";
export function GrowthChart({
  data,
}: {
  data: { label: string; members: number }[];
}) {
  return (
    <div
      className="chart"
      style={{ height: 235 }}
      role="img"
      aria-label="Динамика количества участников"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 10, right: 8, left: -25, bottom: 0 }}
        >
          <CartesianGrid
            vertical={false}
            stroke="#222939"
            strokeDasharray="3 5"
          />
          <XAxis
            dataKey="label"
            tick={axis}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis tick={axis} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={tooltip} cursor={{ fill: "#8585ff0a" }} />
          <Bar
            name="Участники"
            dataKey="members"
            fill="#8585FF"
            radius={[4, 4, 0, 0]}
            maxBarSize={30}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
