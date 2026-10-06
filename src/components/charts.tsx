import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMoney, formatMonth, formatNumber } from "@/lib/format";
import { useAppStore } from "@/lib/store";

const GRID = "color-mix(in oklab, var(--color-foreground) 6%, transparent)";
const TICK = "var(--color-muted-foreground)";
const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-silver)",
  "var(--color-up)",
  "var(--color-warn)",
];

function ChartTip({
  active,
  payload,
  label,
  money = true,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
  money?: boolean;
}) {
  const ccy = useAppStore((s) => s.displayCurrency);
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-popover px-3 py-2 text-xs shadow-[var(--shadow-border)]">
      <div className="mb-1 text-muted-foreground">{label ? formatMonth(label.length === 7 ? `${label}-01` : label) : ""}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6 tabular">
          <span className="text-muted-foreground">{p.name}</span>
          <span>{money ? formatMoney(p.value, ccy, { compact: true }) : formatNumber(p.value, true)}</span>
        </div>
      ))}
    </div>
  );
}

export function DualArea({
  data,
  aKey,
  bKey,
  aName,
  bName,
}: {
  data: Array<Record<string, string | number>>;
  aKey: string;
  bKey: string;
  aName: string;
  bName: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatMonth(String(v).length === 7 ? `${v}-01` : String(v))}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatNumber(Number(v), true)}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTip />} />
        <Area type="monotone" dataKey={aKey} name={aName} stroke="var(--color-chart-1)" fill="var(--color-chart-1)" fillOpacity={0.18} strokeWidth={1.6} />
        <Area type="monotone" dataKey={bKey} name={bName} stroke="var(--color-chart-2)" fill="var(--color-chart-2)" fillOpacity={0.1} strokeWidth={1.6} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SimpleBar({ data, money = true }: { data: Array<{ name: string; value: number }>; money?: boolean }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={{ fill: TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatNumber(Number(v), true)}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTip money={money} />} />
        <Bar dataKey="value" name="Value" radius={[6, 6, 0, 0]} fill="var(--color-chart-1)" maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  const ccy = useAppStore((s) => s.displayCurrency);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="82%" paddingAngle={2} stroke="none">
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v) => formatMoney(Number(v), ccy, { compact: true })}
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            color: "var(--color-popover-foreground)",
          }}
        />
        <Legend
          verticalAlign="bottom"
          height={36}
          formatter={(v) => <span className="text-xs text-muted-foreground">{v}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function StackedSpend({ data }: { data: Array<Record<string, string | number>> }) {
  const keys = data.length
    ? Object.keys(data[0]!).filter((k) => k !== "period")
    : [];
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatMonth(String(v).length === 7 ? `${v}-01` : String(v))}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatNumber(Number(v), true)}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTip />} />
        {keys.map((k, i) => (
          <Bar key={k} dataKey={k} stackId="a" fill={COLORS[i % COLORS.length]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ForecastLines({ data }: { data: Array<{ period: string; actual: number; expected: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatMonth(String(v).length === 7 ? `${v}-01` : String(v))}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatNumber(Number(v), true)}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTip />} />
        <Line type="monotone" dataKey="actual" name="Actual" stroke="var(--color-chart-1)" strokeWidth={1.8} dot={false} />
        <Line type="monotone" dataKey="expected" name="Expected" stroke="var(--color-chart-2)" strokeWidth={1.8} dot={false} strokeDasharray="4 4" />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function DemandLines({
  data,
}: {
  data: Array<{ period: string; avg: number; norm: number; expected: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="period"
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatMonth(String(v).length === 7 ? `${v}-01` : String(v))}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TICK, fontSize: 11 }}
          tickFormatter={(v) => formatNumber(Number(v), true)}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip content={<ChartTip money={false} />} />
        <Line type="monotone" dataKey="avg" name="Average" stroke="var(--color-chart-4)" strokeWidth={1.6} dot={false} />
        <Line type="monotone" dataKey="norm" name="Norm" stroke="var(--color-chart-3)" strokeWidth={1.6} dot={false} />
        <Line type="monotone" dataKey="expected" name="Expected" stroke="var(--color-chart-1)" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
