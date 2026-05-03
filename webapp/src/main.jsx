import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, AlertTriangle, BadgeCheck, Footprints, Play, ShieldCheck, Users } from 'lucide-react';
import './styles.css';

const chapters = [
  {
    label: '第一幕',
    tab: '人流',
    title: '人流不是匀速水龙头',
    text: '观众到达像随时间变化的事件流。开场前一小时和最后二十分钟会形成两个波峰，单位时间到达数用非齐次泊松过程近似。',
    formula: 'N(t+Δt)-N(t) ~ Poisson(∫ λ(u)du)',
    focus: ['maxQueue', 'risk']
  },
  {
    label: '第二幕',
    tab: '排队',
    title: '短时冲击会积累成队列',
    text: '当瞬时到达强度超过安检服务能力时，队列会把短时随机波动积累成拥堵。本幕观察通道数和服务效率如何改变尾部风险。',
    formula: 'Q(t+1)=max{0, Q(t)+A(t)-S(t)}',
    focus: ['maxQueue', 'wait', 'risk']
  },
  {
    label: '第三幕',
    tab: '报警',
    title: '低基率让报警可信度低于直觉',
    text: '真实风险个体占比很低时，即使识别系统灵敏度较高，误报仍会消耗大量警力。后验概率比单纯准确率更能解释报警质量。',
    formula: 'P(T|B)=P(B|T)P(T) / P(B)',
    focus: ['ppv', 'review']
  },
  {
    label: '第四幕',
    tab: '巡逻',
    title: '巡逻发现是首达时问题',
    text: '场馆被抽象成二维网格，巡逻队在网格上移动。偏向热点的随机游走可以缩短首次发现异常点的时间。',
    formula: 'τ = inf{t ≥ 0 : X_t = hotspot}',
    focus: ['hit']
  },
  {
    label: '第五幕',
    tab: '决策',
    title: '组合策略形成安全冗余',
    text: '错峰入场、增开通道、降低误报和热点巡逻分别作用于不同环节。最稳健方案不是单点优化，而是组合压低尾部风险。',
    formula: 'Risk = P(max Q(t)>L),  Strategy = min(Risk + Cost)',
    focus: ['risk', 'ppv', 'hit']
  }
];

const presets = {
  baseline: { name: '基准方案', peak: 1.2, gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  staggered: { name: '错峰入场', peak: 0.82, gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  gates: { name: '增开通道', peak: 1.2, gates: 44, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.005 },
  combo: { name: '组合优化', peak: 0.82, gates: 44, service: 21, threshold: 2500, patrols: 8, bias: 0.85, falseAlarm: 0.0022 }
};

function rngFactory(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng) {
  const u = Math.max(rng(), 1e-9);
  const v = Math.max(rng(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rng();
    } while (p > limit);
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
  const arrivals = [];
  const queue = [];
  const capacity = p.gates * p.service;
  let q = 0;
  let weightedWait = 0;
  let weight = 0;
  lambda.forEach((l) => {
    const a = poisson(l, rng);
    const s = poisson(capacity, rng);
    q = Math.max(0, q + a - s);
    arrivals.push(a);
    queue.push(q);
    weightedWait += (q / capacity) * Math.max(a, 1);
    weight += Math.max(a, 1);
  });
  return { arrivals, queue, maxQueue: Math.max(...queue), avgWait: weightedWait / weight };
}

function monteCarloQueue(p, trials = 140) {
  const values = [];
  const waits = [];
  for (let i = 0; i < trials; i += 1) {
    const result = simulateQueue(p, 300000 + i);
    values.push(result.maxQueue);
    waits.push(result.avgWait);
  }
  values.sort((a, b) => a - b);
  waits.sort((a, b) => a - b);
  return {
    risk: values.filter((v) => v > p.threshold).length / trials,
    meanMax: mean(values),
    p90: percentile(values, 0.9),
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
    trueAlerts,
    falseAlerts,
    reviewHours: (falseAlerts * 2 * 20) / 60
  };
}

function patrolOnce(p, seed) {
  const rng = rngFactory(seed);
  const width = 12;
  const height = 8;
  const target = { x: 8, y: 5 };
  const starts = [{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 11, y: 0 }, { x: 11, y: 7 }, { x: 2, y: 0 }, { x: 9, y: 7 }];
  const positions = Array.from({ length: p.patrols }, (_, i) => ({ ...starts[i % starts.length] }));
  const paths = positions.map((pos) => [{ ...pos }]);
  for (let minute = 1; minute <= 90; minute += 1) {
    for (let i = 0; i < positions.length; i += 1) {
      let dx = 0;
      let dy = 0;
      if (rng() < p.bias) {
        const sx = Math.sign(target.x - positions[i].x);
        const sy = Math.sign(target.y - positions[i].y);
        if (rng() < 0.5 && sx !== 0) dx = sx;
        else if (sy !== 0) dy = sy;
        else dx = sx;
      } else {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        const step = dirs[Math.floor(rng() * dirs.length)];
        dx = step[0];
        dy = step[1];
      }
      positions[i].x = clamp(positions[i].x + dx, 0, width - 1);
      positions[i].y = clamp(positions[i].y + dy, 0, height - 1);
      paths[i].push({ ...positions[i] });
      if (positions[i].x === target.x && positions[i].y === target.y) return { hit: minute, paths, target, width, height };
    }
  }
  return { hit: 90, paths, target, width, height };
}

function monteCarloPatrol(p, trials = 160) {
  const times = [];
  for (let i = 0; i < trials; i += 1) times.push(patrolOnce(p, 700000 + i).hit);
  times.sort((a, b) => a - b);
  return { median: percentile(times, 0.5), p90: percentile(times, 0.9), miss45: times.filter((t) => t > 45).length / trials };
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function percentile(values, p) {
  return values[Math.round((values.length - 1) * p)] || 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function fmt(value) {
  return Math.round(value).toLocaleString('zh-CN');
}

function pct(value) {
  return `${(value * 100).toFixed(value < 0.1 ? 1 : 0)}%`;
}

function linePoints(values, width, height, maxY) {
  return values.map((v, i) => `${(i / (values.length - 1)) * width},${height - (v / maxY) * height}`).join(' ');
}

function QueueChart({ queue, params }) {
  const width = 900;
  const height = 330;
  const maxArrival = Math.max(...queue.arrivals, params.gates * params.service) * 1.15;
  const maxQueue = Math.max(...queue.queue, params.threshold) * 1.2;
  const thresholdY = 155 + 135 - (params.threshold / maxQueue) * 135;
  const capacityY = 25 + 115 - ((params.gates * params.service) / maxArrival) * 115;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart">
      <rect x="0" y="0" width={width} height={height} rx="18" fill="#fffaf2" />
      <text x="24" y="34" className="chart-title">入场事件流与队列演化</text>
      <line x1="42" y1={capacityY} x2="858" y2={capacityY} className="service-line" />
      <polyline points={linePoints(queue.arrivals, 816, 115, maxArrival)} transform="translate(42 25)" className="arrival-line" />
      <polyline points={linePoints(queue.queue, 816, 135, maxQueue)} transform="translate(42 155)" className="queue-line" />
      <line x1="42" y1={thresholdY} x2="858" y2={thresholdY} className="threshold-line" />
      <text x="690" y={thresholdY - 8} className="axis-text">阈值 {fmt(params.threshold)} 人</text>
      <text x="42" y="306" className="axis-text">0 分钟</text>
      <text x="422" y="306" className="axis-text">60 分钟</text>
      <text x="790" y="306" className="axis-text">120 分钟</text>
      <text x="678" y="52" className="legend blue">到达人数</text>
      <text x="678" y="78" className="legend green">平均服务能力</text>
    </svg>
  );
}

function PatrolGrid({ sample }) {
  const palette = ['#2563eb', '#0f766e', '#c2410c', '#7c3aed', '#be123c', '#15803d', '#334155', '#be185d'];
  return (
    <div className="patrol-grid" style={{ gridTemplateColumns: `repeat(${sample.width}, 1fr)` }}>
      {Array.from({ length: sample.width * sample.height }, (_, index) => {
        const x = index % sample.width;
        const y = Math.floor(index / sample.width);
        const dist = Math.hypot(x - sample.target.x, y - sample.target.y);
        const heat = Math.max(0, 1 - dist / 7);
        const visitor = sample.paths.findIndex((path) => path.some((p) => p.x === x && p.y === y));
        return (
          <div
            key={`${x}-${y}`}
            className={`cell ${x === sample.target.x && y === sample.target.y ? 'target' : ''}`}
            style={{ background: `rgba(194, 65, 12, ${0.08 + heat * 0.28})`, borderColor: visitor >= 0 ? palette[visitor % palette.length] : undefined }}
          />
        );
      })}
    </div>
  );
}

function Kpi({ id, icon, label, value, unit, active, danger }) {
  return (
    <div className={`kpi ${active ? 'active' : ''} ${danger ? 'danger' : ''}`}>
      <div className="kpi-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{unit}</small>
    </div>
  );
}

function App() {
  const [params, setParams] = useState(presets.baseline);
  const [chapter, setChapter] = useState(0);
  const data = useMemo(() => {
    const queue = simulateQueue(params, 202405);
    const mc = monteCarloQueue(params);
    const rec = recognition(params);
    const patrol = monteCarloPatrol(params);
    const sample = patrolOnce(params, 90909);
    const alternatives = Object.values(presets).map((preset) => ({ name: preset.name, risk: monteCarloQueue(preset, 80).risk }));
    return { queue, mc, rec, patrol, sample, alternatives };
  }, [params]);
  const current = chapters[chapter];
  const focus = new Set(current.focus);
  const verdict = data.mc.risk > 0.4 ? '拥堵尾部风险偏高' : data.rec.ppv < 0.18 ? '误报核查压力突出' : '当前方案具备较好冗余';
  const insights = buildInsights(chapter, params, data);

  function setParam(key, value) {
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  function playStory() {
    let next = 0;
    const timer = window.setInterval(() => {
      setChapter(next);
      next += 1;
      if (next >= chapters.length) window.clearInterval(timer);
    }, 1400);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">概率论与随机过程 · 高阶叙事性模拟 Web App</p>
          <h1>大型活动安防中的随机到达、排队拥堵与巡逻发现</h1>
          <p>通过完整 Web 应用，把 6 万人演唱会安防拆成五幕故事：人流、排队、报警、巡逻与决策。</p>
        </div>
        <div className="verdict-card">
          <ShieldCheck size={30} />
          <span>当前综合判断</span>
          <strong>{verdict}</strong>
        </div>
      </section>

      <section className="layout">
        <aside className="story-card">
          <div className="tabs">
            {chapters.map((item, index) => (
              <button key={item.tab} className={chapter === index ? 'selected' : ''} onClick={() => setChapter(index)}>{item.tab}</button>
            ))}
          </div>
          <div className="progress"><span style={{ width: `${((chapter + 1) / chapters.length) * 100}%` }} /></div>
          <article>
            <small>{current.label} · 步骤 {chapter + 1}/{chapters.length}</small>
            <h2>{current.title}</h2>
            <p>{current.text}</p>
            <code>{current.formula}</code>
          </article>
          <div className="step-actions">
            <button onClick={() => setChapter(Math.max(0, chapter - 1))}>上一步</button>
            <button onClick={() => setChapter(Math.min(chapters.length - 1, chapter + 1))}>下一步</button>
            <button className="primary" onClick={playStory}><Play size={16} /> 自动演示</button>
          </div>
          <div className="preset-grid">
            {Object.entries(presets).map(([key, preset]) => <button key={key} onClick={() => setParams(preset)}>{preset.name}</button>)}
          </div>
          <Control label="到达集中度" value={params.peak} min={0.7} max={1.9} step={0.05} onChange={(v) => setParam('peak', v)} format={(v) => v.toFixed(2)} />
          <Control label="安检通道数" value={params.gates} min={30} max={62} step={1} onChange={(v) => setParam('gates', v)} format={(v) => `${v.toFixed(0)} 个`} />
          <Control label="单通道效率" value={params.service} min={14} max={28} step={0.5} onChange={(v) => setParam('service', v)} format={(v) => `${v.toFixed(1)} 人/分`} />
          <Control label="误报率" value={params.falseAlarm * 100} min={0.05} max={2} step={0.05} onChange={(v) => setParam('falseAlarm', v / 100)} format={(v) => `${v.toFixed(2)}%`} />
          <Control label="热点偏向" value={params.bias * 100} min={5} max={95} step={5} onChange={(v) => setParam('bias', v / 100)} format={(v) => `${v.toFixed(0)}%`} />
        </aside>

        <section className="dashboard">
          <div className="kpi-grid">
            <Kpi id="maxQueue" icon={<Users />} label="最大队列" value={fmt(data.queue.maxQueue)} unit="人" active={focus.has('maxQueue')} danger={data.queue.maxQueue > params.threshold} />
            <Kpi id="risk" icon={<AlertTriangle />} label="拥堵风险" value={pct(data.mc.risk)} unit="超过阈值概率" active={focus.has('risk')} danger={data.mc.risk > 0.35} />
            <Kpi id="wait" icon={<Activity />} label="平均等待" value={data.queue.avgWait.toFixed(1)} unit="分钟" active={focus.has('wait')} />
            <Kpi id="ppv" icon={<BadgeCheck />} label="报警可信度" value={pct(data.rec.ppv)} unit="P(真实 | 报警)" active={focus.has('ppv')} danger={data.rec.ppv < 0.18} />
            <Kpi id="hit" icon={<Footprints />} label="发现中位数" value={Math.round(data.patrol.median)} unit="分钟" active={focus.has('hit')} />
            <Kpi id="review" icon={<ShieldCheck />} label="误报核查" value={fmt(data.rec.reviewHours)} unit="警员小时" active={focus.has('review')} />
          </div>

          <div className="insights">
            <h3>本幕关键结论</h3>
            {insights.map((item) => <p key={item}>{item}</p>)}
          </div>

          <QueueChart queue={data.queue} params={params} />

          <div className="lower-grid">
            <div className="panel">
              <h3>巡逻随机游走热区</h3>
              <PatrolGrid sample={data.sample} />
              <p>样本首达时间：{data.sample.hit} 分钟；90 分位首达：{Math.round(data.patrol.p90)} 分钟。</p>
            </div>
            <div className="panel">
              <h3>方案对比</h3>
              {data.alternatives.map((item) => (
                <div className="bar-row" key={item.name}>
                  <span>{item.name}</span>
                  <div><i style={{ width: `${Math.max(3, item.risk * 100)}%` }} /></div>
                  <b>{pct(item.risk)}</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function Control({ label, value, min, max, step, onChange, format }) {
  return (
    <label className="control">
      <span>{label}</span>
      <b>{format(value)}</b>
      <input type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function buildInsights(chapter, params, data) {
  if (chapter === 0) return [`到达集中度为 ${params.peak.toFixed(2)} 时，队列峰值达到 ${fmt(data.queue.maxQueue)} 人。`, `蒙特卡洛显示拥堵概率约 ${pct(data.mc.risk)}，说明不能只看平均人流。`];
  if (chapter === 1) return [`当前总服务能力为 ${fmt(params.gates * params.service)} 人/分钟。`, `平均等待约 ${data.queue.avgWait.toFixed(2)} 分钟，90 分位最大队列约 ${fmt(data.mc.p90)} 人。`];
  if (chapter === 2) return [`误报率 ${(params.falseAlarm * 100).toFixed(2)}% 下，报警后验可信度为 ${pct(data.rec.ppv)}。`, `预计误报约 ${fmt(data.rec.falseAlerts)} 次，会消耗 ${fmt(data.rec.reviewHours)} 警员小时。`];
  if (chapter === 3) return [`热点偏向为 ${pct(params.bias)} 时，巡逻首达中位数为 ${Math.round(data.patrol.median)} 分钟。`, `巡逻问题本质上是随机游走首达时，偏向热点能明显缩短发现时间。`];
  return [`组合优化同时降低到达峰、提高服务能力、降低误报并强化巡逻。`, `这正是完整叙事性模拟的决策闭环：随机过程 → 风险指标 → 安防策略。`];
}

createRoot(document.getElementById('root')).render(<App />);
