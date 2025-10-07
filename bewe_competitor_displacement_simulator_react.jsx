import React, { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  Legend,
} from "recharts";

/**
 * Bewe Competitor Displacement Simulator
 * -------------------------------------------------------------
 * What it does
 * - Lets you rate 5 pillars (0–10) via detailed sub‑criteria
 * - Weights pillars by strategic importance (Product & Ops/CS highest)
 * - Compares YOU vs. a Competitor
 * - Converts scores to a % "probability to displace competitor"
 * - Saves snapshots over time (localStorage) so you can track progress
 * - Includes interactive charts: radar (shape), bar (pillar gap), line (trend)
 *
 * Where to use it
 * - In this chat: it renders live in the preview.
 * - Elsewhere: paste the component into a React project as App.jsx (Vite/Cra/Next) and ensure `recharts` and `framer-motion` are installed.
 *
 * Pillars & default weights (sum = 1)
 * - Product .................................... 0.30
 * - Operations & Customer Service (Ops/CS) ..... 0.30
 * - Sales ...................................... 0.18
 * - Pioneering (first-mover, network) .......... 0.12
 * - Marketing .................................. 0.10
 *
 * Probability model (transparent & tweakable)
 * - Compute weighted score S_you and S_comp
 * - Advantage Δ = S_you − S_comp
 * - Market maturity raises the bar to flip a market: threshold θ = map(maturity)
 * - Convert to probability with a logistic (sigmoid) P = 1/(1+e^{−k(Δ−θ)})
 * - k controls steepness (sensitivity). Both θ and k are adjustable below.
 */

// ----- Utility -----
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const round1 = (x) => Math.round(x * 10) / 10;

// Default pillar weights (you can edit these in the UI too)
const DEFAULT_WEIGHTS = {
  product: 0.30,
  ops: 0.30, // Operations & Customer Service combined
  sales: 0.18,
  pioneering: 0.12,
  marketing: 0.10,
};

// Sub‑criteria with internal weights based on common SaaS/service research
const SUBS = {
  product: {
    label: "Product",
    items: [
      { key: "pmf", label: "Product–Market Fit", w: 0.30 },
      { key: "reliability", label: "Reliability/Uptime", w: 0.20 },
      { key: "ux", label: "UX & Usability", w: 0.20 },
      { key: "featureParity", label: "Core Feature Parity/Edge", w: 0.20 },
      { key: "dataSecurity", label: "Data & Security/Compliance", w: 0.10 },
    ],
  },
  ops: {
    label: "Operations & Customer Service",
    items: [
      { key: "onboarding", label: "Onboarding Speed/Clarity", w: 0.25 },
      { key: "supportSLA", label: "Support SLA & Resolution", w: 0.25 },
      { key: "retention", label: "Retention/Churn Control", w: 0.25 },
      { key: "quality", label: "Ops Quality/Field Execution", w: 0.25 },
    ],
  },
  sales: {
    label: "Sales",
    items: [
      { key: "coverage", label: "Territory Coverage/Activity", w: 0.30 },
      { key: "conversion", label: "Conversion & Win Rate", w: 0.30 },
      { key: "expansion", label: "Expansion/ARPA Growth", w: 0.20 },
      { key: "unitEconomics", label: "CAC Payback/Unit Econ.", w: 0.20 },
    ],
  },
  pioneering: {
    label: "Pioneering",
    items: [
      { key: "firstMover", label: "First‑Mover/Timing Edge", w: 0.30 },
      { key: "networkEffects", label: "Network Effects/Lock‑in", w: 0.40 },
      { key: "brandAuthority", label: "Category Authority/PR", w: 0.30 },
    ],
  },
  marketing: {
    label: "Marketing",
    items: [
      { key: "reach", label: "Reach/Share of Voice", w: 0.30 },
      { key: "targeting", label: "Targeting/Creative Fit", w: 0.30 },
      { key: "costEfficiency", label: "Cost Efficiency (CAC)", w: 0.25 },
      { key: "community", label: "Community/Influencer Leverage", w: 0.15 },
    ],
  },
};

// Sensible defaults (middle-ish) so you can start adjusting quickly
const mkDefaultScores = () => ({
  product: { pmf: 6, reliability: 6, ux: 6, featureParity: 6, dataSecurity: 6 },
  ops: { onboarding: 6, supportSLA: 6, retention: 6, quality: 6 },
  sales: { coverage: 5, conversion: 5, expansion: 5, unitEconomics: 5 },
  pioneering: { firstMover: 5, networkEffects: 5, brandAuthority: 5 },
  marketing: { reach: 5, targeting: 5, costEfficiency: 5, community: 5 },
});

// Compute weighted pillar score from sub‑criteria (0–10)
const pillarScore = (pillarKey, valuesObj) => {
  const def = SUBS[pillarKey];
  let sum = 0;
  for (const item of def.items) {
    sum += (valuesObj[item.key] ?? 0) * item.w;
  }
  return sum; // already on 0–10 scale because subs are 0–10
};

// Compute grand score (0–10), then normalize to 0–1
const grandScore01 = (weights, scores) => {
  const w = weights;
  const p = pillarScore("product", scores.product);
  const o = pillarScore("ops", scores.ops);
  const s = pillarScore("sales", scores.sales);
  const n = pillarScore("pioneering", scores.pioneering);
  const m = pillarScore("marketing", scores.marketing);
  const total = w.product * p + w.ops * o + w.sales * s + w.pioneering * n + w.marketing * m;
  return clamp01(total / 10); // normalize
};

// Map market maturity (0–10) to displacement threshold θ in score units (0–1)
// Early markets (0–3) have lower threshold; mature markets (7–10) higher.
const maturityToTheta = (maturity) => {
  const x = maturity / 10; // 0–1
  // θ ranges ~0.10 → 0.30
  return 0.10 + 0.20 * x;
};

// Logistic conversion with adjustable steepness k
const logistic = (x) => 1 / (1 + Math.exp(-x));

const probabilityToDisplace = ({ you01, comp01, maturity = 6, k = 8, shock = 0 }) => {
  const delta = you01 - comp01 + shock; // positive means you're stronger
  const theta = maturityToTheta(maturity); // how much edge you need to flip the market
  const z = k * (delta - theta);
  return clamp01(logistic(z));
};

const Gauge = ({ value }) => {
  // Simple semi‑circular gauge using SVG
  const pct = clamp01(value);
  const angle = 180 * pct; // 0..180 deg
  const r = 100;
  const cx = 120;
  const cy = 120;
  const endX = cx + r * Math.cos(Math.PI - (angle * Math.PI) / 180);
  const endY = cy - r * Math.sin(Math.PI - (angle * Math.PI) / 180);
  const largeArc = angle > 180 ? 1 : 0; // never true here but kept for clarity
  const path = `M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${cx + r} ${cy}`;
  return (
    <svg viewBox="0 0 240 140" className="w-full">
      <path d={path} fill="none" strokeWidth="16" strokeOpacity={0.15} />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 ${largeArc} 1 ${endX} ${endY}`}
        fill="none"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="6" />
      <line x1={cx} y1={cy} x2={endX} y2={endY} strokeWidth="6" strokeLinecap="round" />
      <text x={cx} y={cy + 24} textAnchor="middle" className="text-xl font-semibold">
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
};

const Section = ({ title, children, right }) => (
  <div className="bg-white/60 backdrop-blur rounded-2xl shadow p-4 sm:p-6 border border-gray-100">
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-lg sm:text-xl font-semibold">{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const Slider = ({ label, value, onChange }) => (
  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 items-center py-1.5">
    <div className="sm:col-span-3 text-sm">{label}</div>
    <input
      type="range"
      min={0}
      max={10}
      step={0.5}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="sm:col-span-2 w-full"
    />
    <div className="text-right font-medium">{value}</div>
  </div>
);

const WeightsEditor = ({ weights, setWeights }) => (
  <Section title="Pillar Weights (Importance)">
    <p className="text-sm text-gray-600 mb-3">
      Based on your strategy: Product & Ops/CS highest, then Sales & Pioneering, then Marketing.
      You can fine‑tune below (they will auto‑normalize to sum 1.00).
    </p>
    {Object.entries(weights).map(([k, v]) => (
      <Slider
        key={k}
        label={`${SUBS[k]?.label ?? k} (w)`}
        value={v}
        onChange={(val) => {
          const next = { ...weights, [k]: val };
          // Normalize to sum 1
          const sum = Object.values(next).reduce((a, b) => a + b, 0);
          const norm = Object.fromEntries(
            Object.entries(next).map(([kk, vv]) => [kk, vv / sum])
          );
          setWeights(norm);
        }}
      />
    ))}
    <div className="text-xs text-gray-500 mt-2">
      Current sum: {Object.values(weights).reduce((a, b) => a + b, 0).toFixed(2)}
    </div>
  </Section>
);

const PillarEditor = ({ who, scores, setScores }) => (
  <div className="space-y-5">
    {Object.entries(SUBS).map(([pillarKey, def]) => (
      <Section key={pillarKey} title={`${def.label} — ${who}`}>
        {def.items.map((it) => (
          <Slider
            key={it.key}
            label={`${it.label}`}
            value={scores[pillarKey][it.key]}
            onChange={(val) =>
              setScores((prev) => ({
                ...prev,
                [pillarKey]: { ...prev[pillarKey], [it.key]: val },
              }))
            }
          />
        ))}
        <div className="text-sm text-gray-600 mt-2">
          Pillar score: {round1(pillarScore(pillarKey, scores[pillarKey]))} / 10
        </div>
      </Section>
    ))}
  </div>
);

const TrendLine = ({ history }) => (
  <ResponsiveContainer width="100%" height={240}>
    <LineChart data={history} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="t" tick={{ fontSize: 12 }} />
      <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
      <Tooltip formatter={(v) => `${v}%`} />
      <Line type="monotone" dataKey="p" strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

const RadarCompare = ({ you, comp }) => {
  const data = [
    { pillar: "Product", you: you.product, comp: comp.product },
    { pillar: "Ops/CS", you: you.ops, comp: comp.ops },
    { pillar: "Sales", you: you.sales, comp: comp.sales },
    { pillar: "Pioneering", you: you.pioneering, comp: comp.pioneering },
    { pillar: "Marketing", you: you.marketing, comp: comp.marketing },
  ].map((row) => ({ ...row, you: round1(row.you), comp: round1(row.comp) }));

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={data} outerRadius={110}>
        <PolarGrid />
        <PolarAngleAxis dataKey="pillar" />
        <PolarRadiusAxis angle={30} domain={[0, 10]} />
        <Radar name="You" dataKey="you" strokeWidth={2} fillOpacity={0.15} />
        <Radar name="Competitor" dataKey="comp" strokeWidth={2} fillOpacity={0.12} />
        <Legend />
        <Tooltip />
      </RadarChart>
    </ResponsiveContainer>
  );
};

const GapBars = ({ you, comp }) => {
  const rows = [
    { pillar: "Product", gap: you.product - comp.product },
    { pillar: "Ops/CS", gap: you.ops - comp.ops },
    { pillar: "Sales", gap: you.sales - comp.sales },
    { pillar: "Pioneering", gap: you.pioneering - comp.pioneering },
    { pillar: "Marketing", gap: you.marketing - comp.marketing },
  ].map((r) => ({ ...r, gap: round1(r.gap) }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="pillar" />
        <YAxis domain={[-10, 10]} />
        <Tooltip />
        <Bar dataKey="gap" />
      </BarChart>
    </ResponsiveContainer>
  );
};

const Sensitivity = ({ weights, baseScoresYou, baseScoresComp, pillarKey, maturity, k }) => {
  // Sweep the chosen pillar +/− 3 points for YOU and recompute probability
  const sweep = Array.from({ length: 13 }, (_, i) => i - 6); // −6..+6 → we will clamp
  const label = SUBS[pillarKey].label;
  const data = sweep.map((offset) => {
    const clone = JSON.parse(JSON.stringify(baseScoresYou));
    const firstItem = SUBS[pillarKey].items[0].key;
    const v = clamp01((clone[pillarKey][firstItem] + offset) / 10) * 10; // keep in 0–10
    clone[pillarKey][firstItem] = Math.max(0, Math.min(10, v));

    const you01 = grandScore01(weights, clone);
    const comp01 = grandScore01(weights, baseScoresComp);
    const p = probabilityToDisplace({ you01, comp01, maturity, k });
    return { x: offset, p: Math.round(p * 100) };
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="x" label={{ value: `${label} (first sub‑factor) +/−`, position: "insideBottom", offset: -2 }} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip formatter={(v) => `${v}%`} />
        <Line type="monotone" dataKey="p" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export default function CompetitorDisplacementSimulator() {
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [you, setYou] = useState(mkDefaultScores());
  const [comp, setComp] = useState(mkDefaultScores());

  const [maturity, setMaturity] = useState(6); // 0–10, higher = harder to flip market
  const [steepness, setSteepness] = useState(8); // k in logistic
  const [shock, setShock] = useState(0); // −0.2..+0.2 exogenous shock (regulation, macro, etc.)

  const youPillars = useMemo(
    () => ({
      product: round1(pillarScore("product", you.product)),
      ops: round1(pillarScore("ops", you.ops)),
      sales: round1(pillarScore("sales", you.sales)),
      pioneering: round1(pillarScore("pioneering", you.pioneering)),
      marketing: round1(pillarScore("marketing", you.marketing)),
    }),
    [you]
  );

  const compPillars = useMemo(
    () => ({
      product: round1(pillarScore("product", comp.product)),
      ops: round1(pillarScore("ops", comp.ops)),
      sales: round1(pillarScore("sales", comp.sales)),
      pioneering: round1(pillarScore("pioneering", comp.pioneering)),
      marketing: round1(pillarScore("marketing", comp.marketing)),
    }),
    [comp]
  );

  const you01 = useMemo(() => grandScore01(weights, you), [weights, you]);
  const comp01 = useMemo(() => grandScore01(weights, comp), [weights, comp]);

  const probability = useMemo(
    () => probabilityToDisplace({ you01, comp01, maturity, k: steepness, shock }),
    [you01, comp01, maturity, steepness, shock]
  );

  // History (snapshots)
  const [history, setHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("bewe_sim_history");
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("bewe_sim_history", JSON.stringify(history));
    } catch {}
  }, [history]);

  const addSnapshot = () => {
    const now = new Date();
    const label = now.toLocaleString();
    const pct = Math.round(probability * 100);
    setHistory((h) => [...h.slice(-99), { t: label, p: pct }]);
  };

  const clearHistory = () => setHistory([]);

  // Derived UI
  const deltaPct = Math.round((you01 - comp01) * 1000) / 10; // in %-points of score

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-gray-50 to-gray-100 text-gray-900">
      <div className="max-w-7xl mx-auto p-4 sm:p-6 md:p-8 space-y-6">
        <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">Bewe — Competitor Displacement Simulator</h1>
            <p className="text-gray-600 text-sm sm:text-base mt-1">Model your position vs. a rival across 5 pillars. Tune weights, market maturity, and more. Save snapshots to track strategy impact over time.</p>
          </div>
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="bg-white rounded-2xl shadow border p-4 w-full sm:w-[320px]">
              <div className="text-xs text-gray-500">Probability to Displace</div>
              <Gauge value={probability} />
              <div className="flex items-center justify-between text-sm">
                <div>Advantage Δ (score):</div>
                <div className={`font-semibold ${you01 >= comp01 ? "text-green-700" : "text-red-700"}`}>
                  {deltaPct >= 0 ? "+" : ""}{deltaPct}%
                </div>
              </div>
            </div>
          </motion.div>
        </header>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Section
              title="Market Dynamics & Model Settings"
              right={
                <div className="flex gap-2">
                  <button onClick={addSnapshot} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-gray-50 text-sm">Save Snapshot</button>
                  <button onClick={clearHistory} className="px-3 py-1.5 rounded-xl border bg-white hover:bg-gray-50 text-sm">Clear</button>
                </div>
              }
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Slider label={`Market maturity (harder flip) — ${maturity}`} value={maturity} onChange={setMaturity} />
                  <Slider label={`Model steepness (k) — ${steepness}`} value={steepness} onChange={setSteepness} />
                  <Slider label={`External shock (−0.2…+0.2)`} value={shock} onChange={setShock} />
                  <div className="text-xs text-gray-500">
                    Shock lets you simulate regulation/macros or a PR blow (+ helps you, − helps rival). It shifts both scores before conversion.
                  </div>
                </div>
                <div>
                  <WeightsEditor weights={weights} setWeights={setWeights} />
                </div>
              </div>
            </Section>

            <Section title="Your Inputs (Bewe)">
              <PillarEditor who="You" scores={you} setScores={setYou} />
            </Section>

            <Section title="Competitor Inputs">
              <PillarEditor who="Competitor" scores={comp} setScores={setComp} />
            </Section>
          </div>

          <div className="xl:col-span-1 space-y-6">
            <Section title="Score Shapes (Radar)">
              <RadarCompare you={youPillars} comp={compPillars} />
            </Section>

            <Section title="Pillar Gaps (You − Competitor)">
              <GapBars you={youPillars} comp={compPillars} />
            </Section>

            <Section title="Sensitivity (What if you improve one lever?)">
              <Sensitivity
                weights={weights}
                baseScoresYou={you}
                baseScoresComp={comp}
                pillarKey="ops"
                maturity={maturity}
                k={steepness}
              />
              <div className="text-xs text-gray-500 mt-2">
                Tip: This sweeps the first sub‑factor of the chosen pillar. Change `pillarKey` prop in code to explore others (e.g., "product", "sales").
              </div>
            </Section>

            <Section title="Probability Trend (Snapshots)">
              {history.length === 0 ? (
                <div className="text-sm text-gray-600">No snapshots yet. Click <span className="font-medium">Save Snapshot</span> after a change to start a history.</div>
              ) : (
                <TrendLine history={history} />
              )}
            </Section>
          </div>
        </div>

        <footer className="text-xs text-gray-500 pt-2">
          Notes: (1) All sliders are 0–10. (2) Pillar and sub‑factor weights reflect typical impact patterns in B2B services: product reliability and operational excellence dominate retention and word‑of‑mouth, which drive displacement more than top‑of‑funnel spend alone.
        </footer>
      </div>
    </div>
  );
}
