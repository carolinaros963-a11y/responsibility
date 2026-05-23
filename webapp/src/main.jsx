import React, { useMemo, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, AlertTriangle, BadgeCheck, ChevronLeft, ChevronRight,
  Footprints, Play, ShieldCheck, Users, Zap
} from 'lucide-react';
import './styles.css';

/* ── Chapter data ── */
const chapters = [
  {
    label: '第一幕', tab: '人流',
    title: '人流不是匀速水龙头',
    text: '观众到达像随时间变化的事件流。开场前一小时和最后二十分钟会形成两个波峰，单位时间到达数用非齐次泊松过程近似。',
    formula: 'N(t+Δt) − N(t) ~ Poisson(∫ λ(u) du)',
    focus: ['maxQueue', 'risk']
  },
  {
    label: '第二幕', tab: '排队',
    title: '短时冲击会积累成队列',
    text: '当瞬时到达强度超过安检服务能力时，队列会把短时随机波动积累成拥堵。本幕观察通道数和服务效率如何改变尾部风险。',
    formula: 'Q(t+1) = max{0, Q(t) + A(t) − S(t)}',
    focus: ['maxQueue', 'wait', 'risk']
  },
  {
    label: '第三幕', tab: '报警',
    title: '低基率让报警可信度低于直觉',
    text: '真实风险个体占比很低时，即使识别系统灵敏度较高，误报仍会消耗大量警力。后验概率比单纯准确率更能解释报警质量。',
    formula: 'P(T|B) = P(B|T)·P(T) / P(B)',
    focus: ['ppv', 'review']
  },
  {
    label: '第四幕', tab: '巡逻',
    title: '巡逻发现是首达时问题',
    text: '场馆被抽象成二维网格，巡逻队在网格上移动。偏向热点的随机游走可以缩短首次发现异常点的时间。',
    formula: 'τ = inf{t ≥ 0 : X_t = hotspot}',
    focus: ['hit']
  },
  {
    label: '第五幕', tab: '决策',
    title: '组合策略形成安全冗余',
    text: '错峰入场、增开通道、降低误报和热点巡逻分别作用于不同环节。最稳健方案不是单点优化，而是组合压低尾部风险。',
    formula: 'Risk = P(max Q(t) > L),  Strategy = min(Risk + Cost)',
    focus: ['risk', 'ppv', 'hit']
  }
];

const presets = {
  baseline:  { name: '基准方案', peak: 1.2,  gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  staggered: { name: '错峰入场', peak: 0.82, gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  gates:     { name: '增开通道', peak: 1.2,  gates: 44, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  combo:     { name: '组合优化', peak: 0.82, gates: 44, service: 21, threshold: 2500, patrols: 8, bias: 0.85, falseAlarm: 0.0022 }
};

/* ── Simulation engine ── */
function rngFactory(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng) {
  const u = Math.max(rng(), 1e-9), v = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k += 1; p *= rng(); } while (p > limit);
    return k - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * normal(rng)));
}

function arrivalProfile(p) {
  const raw = [];
  let sum = 0;
  for (let t = 0; t <= 120; t += 1) {
    const early = Math.exp(-0.5 * ((t - 68) / 18) ** 2);
    const late = 0.72 * Math.exp(-0.5 * ((t - 102) / 9) ** 2);
    const value = 0.22 + p.peak * (early + late);
    raw.push(value);
    sum += value;
  }
  return raw.map((v) => (60000 * v) / sum);
}

function simulateQueue(p, seed) {
  const rng = rngFactory(seed);
  const lambda = arrivalProfile(p);
  const arrivals = [], queue = [];
  const capacity = p.gates * p.service;
  let q = 0, ww = 0, w = 0;
  lambda.forEach((l) => {
    const a = poisson(l, rng), s = poisson(capacity, rng);
    q = Math.max(0, q + a - s);
    arrivals.push(a);
    queue.push(q);
    ww += (q / capacity) * Math.max(a, 1);
    w += Math.max(a, 1);
  });
  return { arrivals, queue, maxQueue: Math.max(...queue), avgWait: ww / w };
}

function monteCarloQueue(p, trials = 140) {
  const vals = [], waits = [];
  for (let i = 0; i < trials; i++) {
    const r = simulateQueue(p, 300000 + i);
    vals.push(r.maxQueue);
    waits.push(r.avgWait);
  }
  vals.sort((a, b) => a - b);
  waits.sort((a, b) => a - b);
  return {
    risk: vals.filter((v) => v > p.threshold).length / trials,
    meanMax: mean(vals),
    p90: percentile(vals, 0.9),
    wait: mean(waits)
  };
}

function recognition(p) {
  const suspects = 50;
  const trueAlerts = suspects * 0.95;
  const falseAlerts = (60000 - suspects) * p.falseAlarm;
  const total = trueAlerts + falseAlerts;
  return {
    ppv: total ? trueAlerts / total : 0,
    trueAlerts, falseAlerts,
    reviewHours: (falseAlerts * 2 * 20) / 60
  };
}

function patrolOnce(p, seed) {
  const rng = rngFactory(seed);
  const W = 12, H = 8;
  const target = { x: 8, y: 5 };
  const starts = [{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 11, y: 0 }, { x: 11, y: 7 }, { x: 2, y: 0 }, { x: 9, y: 7 }];
  const pos = Array.from({ length: p.patrols }, (_, i) => ({ ...starts[i % starts.length] }));
  const paths = pos.map((p) => [{ ...p }]);
  for (let m = 1; m <= 90; m++) {
    for (let i = 0; i < pos.length; i++) {
      let dx = 0, dy = 0;
      if (rng() < p.bias) {
        const sx = Math.sign(target.x - pos[i].x), sy = Math.sign(target.y - pos[i].y);
        if (rng() < 0.5 && sx !== 0) dx = sx; else if (sy !== 0) dy = sy; else dx = sx;
      } else {
        const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
        const step = dirs[Math.floor(rng() * dirs.length)];
        dx = step[0]; dy = step[1];
      }
      pos[i].x = clamp(pos[i].x + dx, 0, W - 1);
      pos[i].y = clamp(pos[i].y + dy, 0, H - 1);
      paths[i].push({ ...pos[i] });
      if (pos[i].x === target.x && pos[i].y === target.y) return { hit: m, paths, target, width: W, height: H };
    }
  }
  return { hit: 90, paths, target, width: W, height: H };
}

function monteCarloPatrol(p, trials = 160) {
  const times = [];
  for (let i = 0; i < trials; i++) times.push(patrolOnce(p, 700000 + i).hit);
  times.sort((a, b) => a - b);
  return { median: percentile(times, 0.5), p90: percentile(times, 0.9), miss45: times.filter((t) => t > 45).length / trials };
}

function mean(v) { return v.reduce((a, x) => a + x, 0) / v.length; }
function percentile(v, p) { return v[Math.round((v.length - 1) * p)] || 0; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function fmt(v) { return Math.round(v).toLocaleString('zh-CN'); }
function pct(v) { return `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`; }

/* ── Chart helper ── */
function toPoints(values, w, h, maxY) {
  const n = values.length;
  return values.map((v, i) => `${(i / (n - 1)) * w},${h - (v / maxY) * h}`).join(' ');
}

function areaPoints(values, w, h, maxY) {
  const n = values.length;
  const line = values.map((v, i) => `${(i / (n - 1)) * w},${h - (v / maxY) * h}`).join(' ');
  return `${line} ${w},${h} 0,${h}`;
}

/* ── Queue Chart ── */
function QueueChart({ queue, params }) {
  const W = 900, H = 340;
  const pad = { l: 56, r: 24, t: 48, b: 36 };
  const cw = W - pad.l - pad.r;
  const ch1 = 110, gap = 16, ch2 = 120;
  const maxA = Math.max(...queue.arrivals, params.gates * params.service) * 1.15;
  const maxQ = Math.max(...queue.queue, params.threshold) * 1.2;
  const capY = pad.t + ch1 - ((params.gates * params.service) / maxA) * ch1;
  const thrY = pad.t + ch1 + gap + ch2 - (params.threshold / maxQ) * ch2;
  const y1 = pad.t + ch1 + gap;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <defs>
        <linearGradient id="gArr" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="gQ" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f97316" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Title */}
      <text x={pad.l} y={28} className="chart-title">入场事件流与队列演化</text>

      {/* Arrival area + line */}
      <polygon points={areaPoints(queue.arrivals, cw, ch1, maxA)} transform={`translate(${pad.l},${pad.t})`} fill="url(#gArr)" />
      <polyline points={toPoints(queue.arrivals, cw, ch1, maxA)} transform={`translate(${pad.l},${pad.t})`} className="arrival-line" />

      {/* Capacity line */}
      <line x1={pad.l} y1={capY} x2={W - pad.r} y2={capY} className="service-line" />
      <text x={W - pad.r - 4} y={capY - 6} textAnchor="end" className="legend green">服务能力 {fmt(params.gates * params.service)} 人/分</text>

      {/* Queue area + line */}
      <polygon points={areaPoints(queue.queue, cw, ch2, maxQ)} transform={`translate(${pad.l},${y1})`} fill="url(#gQ)" />
      <polyline points={toPoints(queue.queue, cw, ch2, maxQ)} transform={`translate(${pad.l},${y1})`} className="queue-line" />

      {/* Threshold line */}
      <line x1={pad.l} y1={thrY} x2={W - pad.r} y2={thrY} className="threshold-line" />
      <text x={W - pad.r - 4} y={thrY - 6} textAnchor="end" className="axis-text" fill="#ef4444">阈值 {fmt(params.threshold)} 人</text>

      {/* X axis */}
      <text x={pad.l} y={H - 8} className="axis-text">0 min</text>
      <text x={pad.l + cw / 2} y={H - 8} className="axis-text">60 min</text>
      <text x={W - pad.r} y={H - 8} className="axis-text" textAnchor="end">120 min</text>

      {/* Legend */}
      <circle cx={pad.l + 8} cy={pad.t - 14} r={5} fill="#6366f1" />
      <text x={pad.l + 20} y={pad.t - 10} className="legend blue">到达人数</text>
      <circle cx={pad.l + 108} cy={pad.t - 14} r={5} fill="#f97316" />
      <text x={pad.l + 120} y={pad.t - 10} className="axis-text" fill="#f97316" fontWeight="600">队列长度</text>
    </svg>
  );
}

/* ── Patrol Grid ── */
const PATROL_COLORS = ['#6366f1', '#14b8a6', '#f97316', '#8b5cf6', '#ef4444', '#22c55e', '#64748b', '#ec4899'];

function PatrolGrid({ sample }) {
  return (
    <div className="patrol-grid" style={{ gridTemplateColumns: `repeat(${sample.width}, 1fr)` }}>
      {Array.from({ length: sample.width * sample.height }, (_, idx) => {
        const x = idx % sample.width;
        const y = Math.floor(idx / sample.width);
        const dist = Math.hypot(x - sample.target.x, y - sample.target.y);
        const heat = Math.max(0, 1 - dist / 7);
        const isTarget = x === sample.target.x && y === sample.target.y;
        const visitor = sample.paths.findIndex((path) => path.some((p) => p.x === x && p.y === y));
        return (
          <div
            key={`${x}-${y}`}
            className={`cell ${isTarget ? 'target' : ''}`}
            style={{
              background: isTarget ? undefined : `rgba(99, 102, 241, ${0.04 + heat * 0.18})`,
              borderColor: visitor >= 0 ? PATROL_COLORS[visitor % PATROL_COLORS.length] : undefined
            }}
          />
        );
      })}
    </div>
  );
}

/* ── KPI Card ── */
function Kpi({ icon, label, value, unit, active, danger }) {
  return (
    <div className={`kpi ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}>
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  );
}

/* ── Slider Control ── */
function Control({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="control">
      <span>{label}</span>
      <b>{format(value)}</b>
      <input type="range" value={value} min={min} max={max} step={step}
        onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/* ── Insights builder ── */
function buildInsights(ch, p, d) {
  if (ch === 0) return [
    `到达集中度 ${p.peak.toFixed(2)} 时，队列峰值达 ${fmt(d.queue.maxQueue)} 人`,
    `蒙特卡洛显示拥堵概率约 ${pct(d.mc.risk)}，不能只看平均人流`
  ];
  if (ch === 1) return [
    `总服务能力 ${fmt(p.gates * p.service)} 人/分钟`,
    `平均等待 ${d.queue.avgWait.toFixed(2)} 分钟，90 分位最大队列 ${fmt(d.mc.p90)} 人`
  ];
  if (ch === 2) return [
    `误报率 ${(p.falseAlarm * 100).toFixed(2)}%，报警后验可信度 ${pct(d.rec.ppv)}`,
    `预计误报 ${fmt(d.rec.falseAlerts)} 次，消耗 ${fmt(d.rec.reviewHours)} 警员小时`
  ];
  if (ch === 3) return [
    `热点偏向 ${pct(p.bias)}，首达中位数 ${Math.round(d.patrol.median)} 分钟`,
    `随机游走首达时问题，偏向热点能明显缩短发现时间`
  ];
  return [
    `组合优化同时降低到达峰、提高服务、降低误报并强化巡逻`,
    `决策闭环：随机过程 → 风险指标 → 安防策略`
  ];
}

/* ── Main App ── */
function App() {
  const [params, setParams] = useState(presets.baseline);
  const [chapter, setChapter] = useState(0);
  const [autoTimer, setAutoTimer] = useState(null);

  const data = useMemo(() => {
    const queue = simulateQueue(params, 202405);
    const mc = monteCarloQueue(params);
    const rec = recognition(params);
    const patrol = monteCarloPatrol(params);
    const sample = patrolOnce(params, 90909);
    const alternatives = Object.values(presets).map((pr) => ({ name: pr.name, risk: monteCarloQueue(pr, 80).risk }));
    return { queue, mc, rec, patrol, sample, alternatives };
  }, [params]);

  const current = chapters[chapter];
  const focus = new Set(current.focus);
  const verdict = data.mc.risk > 0.4 ? '拥堵尾部风险偏高' : data.rec.ppv < 0.18 ? '误报核查压力突出' : '当前方案具备较好冗余';
  const insights = buildInsights(chapter, params, data);

  const setParam = useCallback((key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const stopAuto = useCallback(() => {
    if (autoTimer) { clearInterval(autoTimer); setAutoTimer(null); }
  }, [autoTimer]);

  const playStory = useCallback(() => {
    stopAuto();
    let next = 0;
    const id = window.setInterval(() => {
      setChapter(next);
      next += 1;
      if (next >= chapters.length) { clearInterval(id); setAutoTimer(null); }
    }, 1800);
    setAutoTimer(id);
  }, [stopAuto]);

  return (
    <main className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="story-card">
        <span className="eyebrow">概率论与随机过程 · 高阶叙事性模拟</span>
        <h1>大型活动安防叙事性模拟</h1>
        <p>把 6 万人演唱会安防拆成五幕故事，用随机过程建模、蒙特卡洛量化、交互式探索。</p>

        <div className="tabs">
          {chapters.map((item, i) => (
            <button key={item.tab} className={chapter === i ? 'selected' : ''}
              onClick={() => { stopAuto(); setChapter(i); }}>
              {item.tab}
            </button>
          ))}
        </div>

        <div className="progress">
          <span style={{ width: `${((chapter + 1) / chapters.length) * 100}%` }} />
        </div>

        <article>
          <small>{current.label} · 步骤 {chapter + 1} / {chapters.length}</small>
          <h2>{current.title}</h2>
          <p>{current.text}</p>
          <code>{current.formula}</code>
        </article>

        <div className="step-actions">
          <button onClick={() => { stopAuto(); setChapter(Math.max(0, chapter - 1)); }}><ChevronLeft size={16} /> 上一步</button>
          <button onClick={() => { stopAuto(); setChapter(Math.min(chapters.length - 1, chapter + 1)); }}>下一步 <ChevronRight size={16} /></button>
          <button className="primary" onClick={playStory}><Play size={15} /> 自动演示</button>
        </div>

        <div className="preset-grid">
          {Object.entries(presets).map(([key, pr]) => (
            <button key={key} onClick={() => setParams(pr)}>{pr.name}</button>
          ))}
        </div>

        <Control label="到达集中度" value={params.peak} min={0.7} max={1.9} step={0.05}
          onChange={(v) => setParam('peak', v)} format={(v) => v.toFixed(2)} />
        <Control label="安检通道数" value={params.gates} min={30} max={62} step={1}
          onChange={(v) => setParam('gates', v)} format={(v) => `${v.toFixed(0)} 个`} />
        <Control label="单通道效率" value={params.service} min={14} max={28} step={0.5}
          onChange={(v) => setParam('service', v)} format={(v) => `${v.toFixed(1)} 人/分`} />
        <Control label="误报率" value={params.falseAlarm * 100} min={0.05} max={2} step={0.05}
          onChange={(v) => setParam('falseAlarm', v / 100)} format={(v) => `${v.toFixed(2)}%`} />
        <Control label="热点偏向" value={params.bias * 100} min={5} max={95} step={5}
          onChange={(v) => setParam('bias', v / 100)} format={(v) => `${v.toFixed(0)}%`} />
      </aside>

      {/* ── Dashboard ── */}
      <section className="dashboard">
        {/* Hero + Verdict */}
        <div className="hero">
          <div>
            <h1>随机到达、排队拥堵与巡逻发现</h1>
            <p>五幕叙事性模拟：人流 → 排队 → 报警 → 巡逻 → 决策。每幕对应一个概率模型，参数可调，结果实时计算。</p>
          </div>
          <div className="verdict-card">
            <ShieldCheck size={28} />
            <span>当前综合判断</span>
            <strong>{verdict}</strong>
          </div>
        </div>

        {/* KPIs */}
        <div className="kpi-grid">
          <Kpi icon={<Users size={18} />} label="最大队列" value={fmt(data.queue.maxQueue)} unit="人"
            active={focus.has('maxQueue')} danger={data.queue.maxQueue > params.threshold} />
          <Kpi icon={<AlertTriangle size={18} />} label="拥堵风险" value={pct(data.mc.risk)} unit="超过阈值概率"
            active={focus.has('risk')} danger={data.mc.risk > 0.35} />
          <Kpi icon={<Activity size={18} />} label="平均等待" value={data.queue.avgWait.toFixed(1)} unit="分钟"
            active={focus.has('wait')} />
          <Kpi icon={<BadgeCheck size={18} />} label="报警可信度" value={pct(data.rec.ppv)} unit="P(真实|报警)"
            active={focus.has('ppv')} danger={data.rec.ppv < 0.18} />
          <Kpi icon={<Footprints size={18} />} label="发现中位数" value={`${Math.round(data.patrol.median)}`} unit="分钟"
            active={focus.has('hit')} />
          <Kpi icon={<Zap size={18} />} label="误报核查" value={fmt(data.rec.reviewHours)} unit="警员小时"
            active={focus.has('review')} />
        </div>

        {/* Insights */}
        <div className="insights">
          <h3>本幕关键结论</h3>
          {insights.map((item, i) => <p key={i}>{item}</p>)}
        </div>

        {/* Queue Chart */}
        <QueueChart queue={data.queue} params={params} />

        {/* Lower panels */}
        <div className="lower-grid">
          <div className="panel">
            <h3>巡逻随机游走热区</h3>
            <PatrolGrid sample={data.sample} />
            <p>样本首达 {data.sample.hit} 分钟 · 90 分位首达 {Math.round(data.patrol.p90)} 分钟</p>
          </div>
          <div className="panel">
            <h3>方案拥堵风险对比</h3>
            {data.alternatives.map((item) => (
              <div className="bar-row" key={item.name}>
                <span>{item.name}</span>
                <div><i style={{ width: `${Math.max(4, item.risk * 100)}%` }} /></div>
                <b>{pct(item.risk)}</b>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
