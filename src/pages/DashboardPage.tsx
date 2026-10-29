import { useReducedMotion } from "../lib/useReducedMotion";
import { useEffect, useState } from "react";
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowUpRight, Award, BookOpenCheck, GraduationCap, TrendingUp, UsersRound } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";

type Analytics = {
  summary: { average: number; students: number; passed: number; failed: number; at_risk: number };
  groupAverages: Array<{ id: number; name: string; average: number; students: number }>;
  ranking: Array<{ id: number; student_number: string; name: string; group_name: string; average: number }>;
  subjectAverages: Array<{ id: number; name: string; average: number; failure_rate: number }>;
};

export function DashboardPage() {
  const reducedMotion = useReducedMotion();
  const [data, setData] = useState<Analytics | null>(null);
  useEffect(() => { api<Analytics>("/analytics").then(setData); }, []);

  const totalResults = (data?.summary.passed || 0) + (data?.summary.failed || 0);
  const passRate = totalResults ? Math.round((data!.summary.passed / totalResults) * 100) : 0;
  return (
    <div className="page-stack">
      <section className="overview-strip">
        <div>
          <span>Estado académico</span>
          <h2>Un vistazo al ciclo activo</h2>
          <p>Resultados consolidados de los registros capturados.</p>
        </div>
        <Link className="text-link" to="/analiticas">Explorar analíticas <ArrowUpRight size={17} /></Link>
      </section>

      <section className="metric-grid">
        <article className="metric">
          <div className="metric-icon metric-blue"><GraduationCap size={20} /></div>
          <div><span>Alumnos activos</span><strong>{data?.summary.students ?? "—"}</strong><small>Con resultados registrados</small></div>
        </article>
        <article className="metric">
          <div className="metric-icon metric-green"><TrendingUp size={20} /></div>
          <div><span>Promedio general</span><strong>{data?.summary.average?.toFixed(1) ?? "—"}</strong><small>Escala institucional</small></div>
        </article>
        <article className="metric">
          <div className="metric-icon metric-gold"><Award size={20} /></div>
          <div><span>Aprobación</span><strong>{passRate}%</strong><small>{data?.summary.passed ?? 0} evaluaciones aprobadas</small></div>
        </article>
        <article className="metric">
          <div className="metric-icon metric-coral"><AlertTriangle size={20} /></div>
          <div><span>En riesgo</span><strong>{data?.summary.at_risk ?? "—"}</strong><small>Resultados bajo el umbral</small></div>
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><span>Comparativo</span><h3>Promedio por grupo</h3></div>
            <BookOpenCheck size={20} />
          </div>
          <div className="chart-frame">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.groupAverages ?? []} margin={{ top: 12, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#e6edf3" vertical={false} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#627d98", fontSize: 12 }} />
                <YAxis domain={[0, 10]} axisLine={false} tickLine={false} tick={{ fill: "#829ab1", fontSize: 11 }} />
                <Tooltip isAnimationActive={!reducedMotion} cursor={{ fill: "#f3f7fa" }} contentStyle={{ border: "1px solid #d9e2ec", borderRadius: 6 }} />
                <Bar isAnimationActive={!reducedMotion} dataKey="average" fill="#7041c4" radius={[3, 3, 0, 0]} maxBarSize={44} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel ranking-panel">
          <div className="panel-heading">
            <div><span>Desempeño</span><h3>Alumnos destacados</h3></div>
            <UsersRound size={20} />
          </div>
          <div className="ranking-list">
            {(data?.ranking ?? []).slice(0, 5).map((student, index) => (
              <div className="ranking-row" key={student.id}>
                <b>{String(index + 1).padStart(2, "0")}</b>
                <div className="mini-avatar">{student.name.split(" ").slice(0, 2).map((part) => part[0]).join("")}</div>
                <div><strong>{student.name}</strong><span>{student.student_number} · {student.group_name}</span></div>
                <em>{student.average.toFixed(1)}</em>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel attention-panel">
        <div className="panel-heading">
          <div><span>Atención académica</span><h3>Materias con mayor reprobación</h3></div>
          <Link className="text-link" to="/calificaciones">Abrir captura <ArrowUpRight size={17} /></Link>
        </div>
        <div className="subject-health-grid">
          {(data?.subjectAverages ?? []).slice(0, 4).map((subject) => (
            <div className="subject-health" key={subject.id}>
              <div><strong>{subject.name}</strong><span>Promedio {subject.average.toFixed(1)}</span></div>
              <div className="progress-track"><i style={{ width: `${Math.min(100, subject.failure_rate)}%` }} /></div>
              <b>{subject.failure_rate}%</b>
            </div>
          ))}
          {!data?.subjectAverages.length && <div className="inline-empty">Aún no hay suficientes calificaciones para este indicador.</div>}
        </div>
      </section>
    </div>
  );
}
