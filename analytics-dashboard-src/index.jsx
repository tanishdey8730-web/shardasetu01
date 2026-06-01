import React, { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell
} from "recharts";

const COLORS = ["#4f46e5", "#0d9488", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

const tooltipStyle = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    fontSize: 13
  }
};

function Filters({ filters, onChange, isAdmin }) {
  return (
    <div className="ad-filters">
      <label>
        Range
        <select value={filters.range} onChange={(e) => onChange({ range: e.target.value })}>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="all">All time</option>
        </select>
      </label>
      {!isAdmin && (
        <>
          <label>
            Exam
            <select value={filters.examId} onChange={(e) => onChange({ examId: e.target.value })}>
              <option value="">All exams</option>
              <option value="ssc-cgl">SSC CGL</option>
              <option value="ssc">SSC</option>
              <option value="nda">NDA</option>
              <option value="cds">CDS</option>
              <option value="afcat">AFCAT</option>
              <option value="rrb-ntpc">RRB NTPC</option>
            </select>
          </label>
          <label>
            Subject
            <select
              value={filters.subjectId}
              onChange={(e) => onChange({ subjectId: e.target.value })}
            >
              <option value="">All subjects</option>
              <option value="quant">Quant</option>
              <option value="maths">Maths</option>
              <option value="physics">Physics</option>
              <option value="chemistry">Chemistry</option>
              <option value="reasoning">Reasoning</option>
              <option value="gs">GS</option>
              <option value="english">English</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }) {
  return (
    <div className="ad-kpi">
      <strong>{value}</strong>
      <span>{label}</span>
      {sub ? <small>{sub}</small> : null}
    </div>
  );
}

function App() {
  const [filters, setFilters] = useState({ range: "30d", examId: "", subjectId: "" });
  const [data, setData] = useState(null);
  const [platform, setPlatform] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const user = window.ShardaAuth?.getUser?.();
  const isAdmin = user?.role === "admin";

  const fetchData = useCallback(async () => {
    if (!window.ShardaAuth?.isLoggedIn?.()) return;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        range: filters.range,
        ...(filters.examId ? { examId: filters.examId } : {}),
        ...(filters.subjectId ? { subjectId: filters.subjectId } : {})
      });
      const res = await window.ShardaAuth.apiFetch(`/api/analytics/advanced?${q}`);
      setData(res);
      if (isAdmin) {
        const plat = await window.ShardaAuth.apiFetch(
          `/api/analytics/platform?range=${filters.range}`
        );
        setPlatform(plat);
      } else {
        setPlatform(null);
      }
    } catch (err) {
      setError(err.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }, [filters, isAdmin]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onFilterChange = (patch) => setFilters((f) => ({ ...f, ...patch }));

  if (!window.ShardaAuth?.isLoggedIn?.()) {
    return (
      <div className="ad-guest">
        <h2>Sign in to view analytics</h2>
        <a href="login.html?next=analytics-dashboard.html" className="btn btn-cta">
          Sign In
        </a>
      </div>
    );
  }

  if (loading && !data) {
    return <div className="ad-loading">Loading advanced analytics…</div>;
  }

  if (error) {
    return <div className="ad-error">{error}</div>;
  }

  const s = data?.summary || {};

  return (
    <div className="ad-app">
      <header className="ad-header">
        <div>
          <h1>Advanced Analytics</h1>
          <p>Interactive insights with Recharts — study hours, progress, subjects &amp; readiness</p>
        </div>
        <button type="button" className="ad-btn-ghost" onClick={fetchData}>
          Refresh
        </button>
      </header>

      <Filters filters={filters} onChange={onFilterChange} isAdmin={isAdmin} />

      <div className="ad-kpi-row">
        <KpiCard label="Readiness" value={`${s.readinessScore ?? "—"}/100`} />
        <KpiCard label="Success probability" value={`${s.successProbability ?? "—"}%`} />
        <KpiCard label="Study hours" value={s.totalStudyHours ?? 0} sub={`${filters.range}`} />
        <KpiCard label="Mock tests" value={s.totalTests ?? 0} />
        <KpiCard label="Avg score" value={`${s.avgScore ?? 0}%`} />
      </div>

      <div className="ad-grid">
        <div className="ad-card ad-span-6">
          <h3>Daily study hours</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data?.dailyStudyHours || []}>
              <defs>
                <linearGradient id="hoursGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="h" />
              <Tooltip {...tooltipStyle} />
              <Area
                type="monotone"
                dataKey="hours"
                stroke="#4f46e5"
                fill="url(#hoursGrad)"
                name="Hours"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="ad-card ad-span-6">
          <h3>Weekly progress</h3>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data?.weeklyProgress || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} domain={[0, 100]} />
              <Tooltip {...tooltipStyle} />
              <Legend />
              <Bar yAxisId="left" dataKey="hours" fill="#0d9488" name="Hours" radius={[4, 4, 0, 0]} />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="avgScore"
                stroke="#f59e0b"
                strokeWidth={2}
                name="Avg score %"
                dot
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="ad-card ad-span-4">
          <h3>Subject-wise performance</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data?.subjectPerformance || []} layout="vertical" margin={{ left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="subject" width={100} tick={{ fontSize: 10 }} />
              <Tooltip {...tooltipStyle} />
              <Bar dataKey="accuracy" name="Accuracy %" fill="#4f46e5" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="ad-card ad-span-4">
          <h3>Activity growth</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data?.personalGrowth || platform?.userGrowth || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend />
              {platform ? (
                <>
                  <Line type="monotone" dataKey="signups" stroke="#4f46e5" name="Signups" />
                  <Line type="monotone" dataKey="totalUsers" stroke="#0d9488" name="Total users" />
                </>
              ) : (
                <>
                  <Line type="monotone" dataKey="cumulative" stroke="#4f46e5" name="Cumulative" />
                  <Line type="monotone" dataKey="tests" stroke="#f59e0b" name="Tests" />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="ad-card ad-span-4">
          <h3>Exam readiness</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data?.examReadiness?.history || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip {...tooltipStyle} />
              <Legend />
              <Line
                type="monotone"
                dataKey="readiness"
                stroke="#8b5cf6"
                strokeWidth={2}
                name="Readiness"
                dot
              />
              <Line type="monotone" dataKey="score" stroke="#06b6d4" name="Test score" dot />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {isAdmin && platform && (
          <div className="ad-card ad-span-12">
            <h3>Platform activity (admin)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={platform.platformActivity || []}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip {...tooltipStyle} />
                <Legend />
                <Bar dataKey="tests" stackId="a" fill="#4f46e5" name="Mock tests" />
                <Bar dataKey="quizzes" stackId="a" fill="#0d9488" name="Quizzes" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {data?.subjectPerformance?.length > 0 && (
          <div className="ad-card ad-span-4">
            <h3>Subject distribution</h3>
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={data.subjectPerformance}
                  dataKey="attempted"
                  nameKey="subject"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={({ subject, accuracy }) => `${subject} ${accuracy}%`}
                >
                  {data.subjectPerformance.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip {...tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

export function mount(el) {
  createRoot(el).render(<App />);
}

if (typeof document !== "undefined") {
  const root = document.getElementById("analytics-root");
  if (root) mount(root);
}
