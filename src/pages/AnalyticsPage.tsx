import { useReducedMotion } from "../lib/useReducedMotion";
import { useEffect, useState } from "react";
import { BarChart3, Filter, Medal, TrendingDown } from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { api } from "../lib/api";
import { Button, Field, Select } from "../components/Ui";

type Option = { id: number; name: string };
type Analytics = {
  summary: { average: number; students: number; passed: number; failed: number; at_risk: number };
  groupAverages: Array<{ id: number; name: string; average: number }>;
  programAverages: Array<{ id: number; name: string; average: number }>;
  shiftAverages: Array<{ id: number; name: string; average: number }>;
  subjectAverages: Array<{ id: number; name: string; average: number; failure_rate: number }>;
  ranking: Array<{ id: number; name: string; student_number: string; group_name: string; average: number }>;
  periodComparison: Array<{ id: number; name: string; average: number }>;
  teacherResults: Array<{ id: number; name: string; groups: number; average: number }>;
};

export function AnalyticsPage() {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<Analytics | null>(null);
  const [options, setOptions] = useState<Record<string, Option[]>>({});
  const [filters, setFilters] = useState({ programId: "", shiftId: "", groupId: "", periodId: "", cycleId: "" });

  async function load() {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)).toString();
    setData(await api<Analytics>(`/analytics${query ? `?${query}` : ""}`));
  }

  useEffect(() => {
    Promise.all(["programs", "shifts", "groups", "periods", "cycles"].map(async (type) => {
      const result = await api<{ records: any[] }>(`/catalogs/${type}`);
      return [type, result.records.map((item) => ({ id: item.id, name: item.name }))] as const;
    })).then((entries) => setOptions(Object.fromEntries(entries)));
    load();
  }, []);

  return (
    <div className="page-stack">
      <section className="filter-bar">
        <div className="filter-title"><Filter size={18} /><span>Filtros</span></div>
        {[
          ["programId", "Programa", "programs"],
          ["shiftId", "Turno", "shifts"],
          ["groupId", "Grupo", "groups"],
          ["periodId", "Periodo", "periods"],
          ["cycleId", "Ciclo", "cycles"]
        ].map(([key, label, source]) => (
          <Field label={label} key={key}>
            <Select value={filters[key as keyof typeof filters]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} options={options[source] ?? []} placeholder="Todos" />
          </Field>
        ))}
        <Button variant="secondary" onClick={load} icon={<BarChart3 size={17} />}>Aplicar</Button>
      </section>

      <section className="metric-grid">
        <article className="metric"><div className="metric-icon metric-blue"><BarChart3 size={20} /></div><div><span>Promedio general</span><strong>{data?.summary.average?.toFixed(1) ?? "—"}</strong><small>Filtro actual</small></div></article>
        <article className="metric"><div className="metric-icon metric-green"><Medal size={20} /></div><div><span>Aprobadas</span><strong>{data?.summary.passed ?? "—"}</strong><small>Evaluaciones</small></div></article>
        <article className="metric"><div className="metric-icon metric-coral"><TrendingDown size={20} /></div><div><span>Reprobadas</span><strong>{data?.summary.failed ?? "—"}</strong><small>Evaluaciones</small></div></article>
        <article className="metric"><div className="metric-icon metric-gold"><Filter size={20} /></div><div><span>Alumnos</span><strong>{data?.summary.students ?? "—"}</strong><small>En la selección</small></div></article>
      </section>

      <section className="analytics-grid">
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span>Grupos</span><h3>Comparativo de promedios</h3></div></div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.groupAverages ?? []} margin={{ left: -18, right: 8, top: 10 }}>
                <CartesianGrid stroke="#e6edf3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} axisLine={false} tickLine={false} />
                <Tooltip isAnimationActive={!reducedMotion} />
                <Bar isAnimationActive={!reducedMotion} dataKey="average" fill="#7041c4" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span>Periodos</span><h3>Evolución del desempeño</h3></div></div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data?.periodComparison ?? []} margin={{ left: -18, right: 20, top: 10 }}>
                <CartesianGrid stroke="#e6edf3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} />
                <YAxis domain={[0, 10]} axisLine={false} tickLine={false} />
                <Tooltip isAnimationActive={!reducedMotion} />
                <Line isAnimationActive={!reducedMotion} dataKey="average" stroke="#087b88" strokeWidth={3} dot={{ fill: "#087b88", r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel chart-panel">
          <div className="panel-heading"><div><span>Materias</span><h3>Índice de reprobación</h3></div></div>
          <div className="chart-frame tall">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.subjectAverages ?? []} layout="vertical" margin={{ left: 26, right: 16 }}>
                <CartesianGrid stroke="#e6edf3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" width={110} axisLine={false} tickLine={false} tick={{ fontSize: 11 }} />
                <Tooltip isAnimationActive={!reducedMotion} />
                <Bar isAnimationActive={!reducedMotion} dataKey="failure_rate" radius={[0, 3, 3, 0]}>
                  {(data?.subjectAverages ?? []).map((entry) => <Cell key={entry.id} fill={entry.failure_rate >= 30 ? "#c2384b" : "#e0a62f"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading"><div><span>Docentes</span><h3>Resultados por asignación</h3></div></div>
          <div className="compact-table">
            {(data?.teacherResults ?? []).map((teacher) => (
              <div key={teacher.id}><strong>{teacher.name}</strong><span>{teacher.groups} grupo(s)</span><b>{teacher.average.toFixed(1)}</b></div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
