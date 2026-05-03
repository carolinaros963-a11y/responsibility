const chapters = [
  {
    kicker: "第一幕",
    title: "人流不是匀速水龙头",
    text: "观众到达更像随时间变化的事件流。开场前一小时和最后二十分钟形成两个峰，单位时间到达数用非齐次泊松过程近似。",
    formula: "N(t+Δt)-N(t) ~ Poisson(∫ λ(u)du)"
  },
  {
    kicker: "第二幕",
    title: "通道能力决定队列是否失稳",
    text: "当瞬时到达强度超过服务能力时，队列会把短时冲击积累成拥堵。这里用 M/M/c 的离散近似追踪队列长度和等待时间。",
    formula: "Q(t+1)=max{0, Q(t)+A(t)-S(t)}"
  },
  {
    kicker: "第三幕",
    title: "低基率会稀释报警可信度",
    text: "即使识别系统灵敏度很高，若真实风险个体占比极低，少量误报也会产生大量核查工作。后验概率比准确率更适合解释报警质量。",
    formula: "P(T|B)=P(B|T)P(T) / P(B)"
  },
  {
    kicker: "第四幕",
    title: "巡逻发现是首达时问题",
    text: "场馆内部被划分为网格，巡逻小组在网格上移动。偏向高风险热点的随机游走会改变首次到达异常位置的时间分布。",
    formula: "τ = inf{t ≥ 0 : X_t = hotspot}"
  },
  {
    kicker: "第五幕",
    title: "安全冗余来自组合策略",
    text: "错峰入场、增开通道、降低误报和热点巡逻分别作用于不同环节。单点优化有用，组合优化更能压低尾部风险。",
    formula: "Risk = P(max Q(t) > L) 与 E[τ] 的联合权衡"
  }
];

const presets = {
  baseline: { peak: 1.20, gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.50 },
  staggered: { peak: 0.82, gates: 36, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.50 },
  moreGates: { peak: 1.20, gates: 44, service: 20, threshold: 2500, patrols: 6, bias: 0.55, falseAlarm: 0.50 },
  smartPatrol: { peak: 1.05, gates: 42, service: 21, threshold: 2500, patrols: 8, bias: 0.85, falseAlarm: 0.22 }
};

const controls = {
  peak: document.querySelector("#peak"),
  gates: document.querySelector("#gates"),
  service: document.querySelector("#service"),
  threshold: document.querySelector("#threshold"),
  patrols: document.querySelector("#patrols"),
  bias: document.querySelector("#bias"),
  falseAlarm: document.querySelector("#falseAlarm")
};

const outputs = {
  peak: document.querySelector("#peakValue"),
  gates: document.querySelector("#gatesValue"),
  service: document.querySelector("#serviceValue"),
  threshold: document.querySelector("#thresholdValue"),
  patrols: document.querySelector("#patrolsValue"),
  bias: document.querySelector("#biasValue"),
  falseAlarm: document.querySelector("#falseAlarmValue")
};

const kpis = {
  maxQueue: document.querySelector("#maxQueue"),
  riskProb: document.querySelector("#riskProb"),
  avgWait: document.querySelector("#avgWait"),
  ppv: document.querySelector("#ppv"),
  hitMedian: document.querySelector("#hitMedian"),
  reviewHours: document.querySelector("#reviewHours"),
  verdict: document.querySelector("#verdict")
};

const chapterEls = {
  kicker: document.querySelector("#chapterKicker"),
  title: document.querySelector("#chapterTitle"),
  text: document.querySelector("#chapterText"),
  formula: document.querySelector("#chapterFormula")
};

let activeChapter = 0;
let updateTimer = 0;

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

function getParams() {
  return {
    audience: 60000,
    minutes: 120,
    peak: Number(controls.peak.value),
    gates: Number(controls.gates.value),
    service: Number(controls.service.value),
    threshold: Number(controls.threshold.value),
    patrols: Number(controls.patrols.value),
    bias: Number(controls.bias.value),
    falseAlarm: Number(controls.falseAlarm.value) / 100,
    sensitivity: 0.95,
    prevalence: 50 / 60000
  };
}

function updateLabels(p) {
  outputs.peak.value = p.peak.toFixed(2);
  outputs.gates.value = p.gates.toFixed(0);
  outputs.service.value = `${p.service.toFixed(1)} 人/分`;
  outputs.threshold.value = `${p.threshold.toFixed(0)} 人`;
  outputs.patrols.value = `${p.patrols.toFixed(0)} 组`;
  outputs.bias.value = `${Math.round(p.bias * 100)}%`;
  outputs.falseAlarm.value = `${(p.falseAlarm * 100).toFixed(2)}%`;
}

function arrivalProfile(p) {
  const raw = [];
  let sum = 0;
  for (let t = 0; t <= p.minutes; t += 1) {
    const early = Math.exp(-0.5 * ((t - 68) / 18) ** 2);
    const late = 0.72 * Math.exp(-0.5 * ((t - 102) / 9) ** 2);
    const value = 0.22 + p.peak * (early + late);
    raw.push(value);
    sum += value;
  }
  return raw.map((v) => (p.audience * v) / sum);
}

function simulateQueue(p, seed) {
  const rng = rngFactory(seed);
  const lambda = arrivalProfile(p);
  const arrivals = [];
  const served = [];
  const queue = [];
  const waits = [];
  const capacityMean = p.gates * p.service;
  let q = 0;
  let weightedWait = 0;
  let weight = 0;

  for (let i = 0; i < lambda.length; i += 1) {
    const a = poisson(lambda[i], rng);
    const capacity = poisson(capacityMean, rng);
    const s = Math.min(q + a, capacity);
    q = Math.max(0, q + a - s);
    const wait = q / Math.max(capacityMean, 1);
    arrivals.push(a);
    served.push(s);
    queue.push(q);
    waits.push(wait);
    weightedWait += wait * Math.max(a, 1);
    weight += Math.max(a, 1);
  }

  return {
    lambda,
    arrivals,
    served,
    queue,
    waits,
    maxQueue: Math.max(...queue),
    avgWait: weightedWait / weight,
    riskMinutes: queue.filter((v) => v > p.threshold).length
  };
}

function monteCarloQueue(p, trials, seed) {
  const maxQueues = [];
  const waits = [];
  for (let i = 0; i < trials; i += 1) {
    const result = simulateQueue(p, seed + i);
    maxQueues.push(result.maxQueue);
    waits.push(result.avgWait);
  }
  maxQueues.sort((a, b) => a - b);
  waits.sort((a, b) => a - b);
  const risk = maxQueues.filter((v) => v > p.threshold).length / trials;
  return {
    risk,
    maxMean: mean(maxQueues),
    maxP90: percentile(maxQueues, 0.90),
    waitMean: mean(waits),
    waitP90: percentile(waits, 0.90)
  };
}

function recognition(p) {
  const suspects = p.audience * p.prevalence;
  const trueAlerts = suspects * p.sensitivity;
  const falseAlerts = (p.audience - suspects) * p.falseAlarm;
  const total = trueAlerts + falseAlerts;
  return {
    trueAlerts,
    falseAlerts,
    total,
    ppv: total > 0 ? trueAlerts / total : 0,
    reviewHours: (falseAlerts * 2 * 20) / 60
  };
}

function patrolOnce(patrols, bias, seed, horizon = 90) {
  const rng = rngFactory(seed);
  const width = 12;
  const height = 8;
  const target = { x: 8, y: 5 };
  const starts = [
    { x: 0, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 2, y: 0 },
    { x: 9, y: height - 1 }
  ];
  const positions = Array.from({ length: patrols }, (_, i) => ({ ...starts[i % starts.length] }));
  const paths = positions.map((p0) => [{ ...p0 }]);

  for (let minute = 1; minute <= horizon; minute += 1) {
    for (let i = 0; i < positions.length; i += 1) {
      let dx = 0;
      let dy = 0;
      if (rng() < bias) {
        const sx = Math.sign(target.x - positions[i].x);
        const sy = Math.sign(target.y - positions[i].y);
        if (rng() < 0.5 && sx !== 0) dx = sx;
        else if (sy !== 0) dy = sy;
        else dx = sx;
      } else {
        const dirs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1]
        ];
        const step = dirs[Math.floor(rng() * dirs.length)];
        dx = step[0];
        dy = step[1];
      }
      positions[i].x = clamp(positions[i].x + dx, 0, width - 1);
      positions[i].y = clamp(positions[i].y + dy, 0, height - 1);
      paths[i].push({ ...positions[i] });
      if (positions[i].x === target.x && positions[i].y === target.y) {
        return { hitTime: minute, paths, target, width, height };
      }
    }
  }
  return { hitTime: horizon, paths, target, width, height };
}

function monteCarloPatrol(patrols, bias, trials, seed) {
  const times = [];
  for (let i = 0; i < trials; i += 1) {
    times.push(patrolOnce(patrols, bias, seed + i).hitTime);
  }
  times.sort((a, b) => a - b);
  return {
    median: percentile(times, 0.50),
    p90: percentile(times, 0.90),
    miss45: times.filter((v) => v > 45).length / trials,
    times
  };
}

function mean(values) {
  return values.reduce((acc, v) => acc + v, 0) / Math.max(values.length, 1);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const idx = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)));
  return values[idx];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatInt(value) {
  return Math.round(value).toLocaleString("zh-CN");
}

function pct(value) {
  return `${Math.round(value * 100)}%`;
}

function drawLine(ctx, values, area, maxY, color, width = 3) {
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = area.x + (i / (values.length - 1)) * area.w;
    const y = area.y + area.h - (v / maxY) * area.h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function setupCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fffaf2";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "22px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.textBaseline = "middle";
  return ctx;
}

function drawAxis(ctx, area, label, color = "#5d6673") {
  ctx.strokeStyle = "#d7ccb8";
  ctx.lineWidth = 1;
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.fillStyle = color;
  ctx.font = "18px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText(label, area.x + 8, area.y + 18);
}

function drawQueue(canvas, p, result) {
  const ctx = setupCanvas(canvas);
  const top = { x: 70, y: 38, w: canvas.width - 110, h: 190 };
  const bottom = { x: 70, y: 282, w: canvas.width - 110, h: 190 };
  const capacity = p.gates * p.service;
  const maxArrival = Math.max(...result.arrivals, capacity) * 1.14;
  const maxQueue = Math.max(...result.queue, p.threshold) * 1.18;

  drawAxis(ctx, top, "到达与服务能力");
  drawAxis(ctx, bottom, "等待队列");

  const capacityY = top.y + top.h - (capacity / maxArrival) * top.h;
  ctx.strokeStyle = "#2f7d4f";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(top.x, capacityY);
  ctx.lineTo(top.x + top.w, capacityY);
  ctx.stroke();
  ctx.setLineDash([]);

  drawLine(ctx, result.arrivals, top, maxArrival, "#245f9d", activeChapter === 0 ? 4 : 2.5);
  drawLine(ctx, result.queue, bottom, maxQueue, "#c76528", activeChapter === 1 ? 4 : 2.5);

  const thresholdY = bottom.y + bottom.h - (p.threshold / maxQueue) * bottom.h;
  ctx.strokeStyle = "#a2372a";
  ctx.setLineDash([9, 7]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(bottom.x, thresholdY);
  ctx.lineTo(bottom.x + bottom.w, thresholdY);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = "rgba(199, 101, 40, 0.16)";
  ctx.beginPath();
  result.queue.forEach((v, i) => {
    const x = bottom.x + (i / (result.queue.length - 1)) * bottom.w;
    const y = bottom.y + bottom.h - (v / maxQueue) * bottom.h;
    if (i === 0) ctx.moveTo(x, bottom.y + bottom.h);
    ctx.lineTo(x, y);
  });
  ctx.lineTo(bottom.x + bottom.w, bottom.y + bottom.h);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#245f9d";
  ctx.fillRect(top.x + top.w - 260, top.y + 14, 18, 5);
  ctx.fillStyle = "#2f7d4f";
  ctx.fillRect(top.x + top.w - 260, top.y + 42, 18, 5);
  ctx.fillStyle = "#17202a";
  ctx.font = "17px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText("到达人数", top.x + top.w - 232, top.y + 17);
  ctx.fillText("平均服务能力", top.x + top.w - 232, top.y + 45);
  ctx.fillStyle = "#a2372a";
  ctx.fillText(`阈值 ${formatInt(p.threshold)} 人`, bottom.x + bottom.w - 180, thresholdY - 16);

  ctx.fillStyle = "#5d6673";
  ctx.font = "16px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText("0", bottom.x - 20, bottom.y + bottom.h + 28);
  ctx.fillText("60", bottom.x + bottom.w / 2 - 12, bottom.y + bottom.h + 28);
  ctx.fillText("120 分钟", bottom.x + bottom.w - 62, bottom.y + bottom.h + 28);
}

function drawPatrol(canvas, sample, patrolStats) {
  const ctx = setupCanvas(canvas);
  const pad = 34;
  const gridW = canvas.width - pad * 2;
  const gridH = canvas.height - pad * 2 - 46;
  const cell = Math.min(gridW / sample.width, gridH / sample.height);
  const startX = (canvas.width - cell * sample.width) / 2;
  const startY = 42;

  for (let y = 0; y < sample.height; y += 1) {
    for (let x = 0; x < sample.width; x += 1) {
      const dx = x - sample.target.x;
      const dy = y - sample.target.y;
      const heat = Math.exp(-0.22 * (dx * dx + dy * dy));
      const red = Math.round(250 - 45 * heat);
      const green = Math.round(248 - 120 * heat);
      const blue = Math.round(238 - 150 * heat);
      ctx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      ctx.fillRect(startX + x * cell, startY + y * cell, cell - 1, cell - 1);
    }
  }

  sample.paths.forEach((path, idx) => {
    const palette = ["#245f9d", "#0f766e", "#c76528", "#7c3aed", "#a2372a", "#2f7d4f", "#334155", "#be185d"];
    ctx.strokeStyle = palette[idx % palette.length];
    ctx.lineWidth = 3;
    ctx.globalAlpha = 0.78;
    ctx.beginPath();
    path.forEach((p, i) => {
      const x = startX + p.x * cell + cell / 2;
      const y = startY + p.y * cell + cell / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  const targetX = startX + sample.target.x * cell + cell / 2;
  const targetY = startY + sample.target.y * cell + cell / 2;
  ctx.fillStyle = "#a2372a";
  ctx.beginPath();
  ctx.arc(targetX, targetY, Math.max(8, cell * 0.22), 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fffdfa";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#17202a";
  ctx.font = "18px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText(`样本首达：${sample.hitTime} 分钟`, 34, canvas.height - 42);
  ctx.fillText(`90% 情形不超过：${Math.round(patrolStats.p90)} 分钟`, 34, canvas.height - 18);
}

function drawDecision(canvas, alternatives) {
  const ctx = setupCanvas(canvas);
  const area = { x: 62, y: 54, w: canvas.width - 108, h: canvas.height - 126 };
  drawAxis(ctx, area, "蒙特卡洛风险概率");
  const maxRisk = Math.max(0.10, ...alternatives.map((d) => d.risk));
  const barGap = 18;
  const barW = (area.w - barGap * (alternatives.length - 1)) / alternatives.length;

  alternatives.forEach((item, i) => {
    const h = (item.risk / maxRisk) * (area.h - 36);
    const x = area.x + i * (barW + barGap);
    const y = area.y + area.h - h;
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y, barW, h);
    ctx.fillStyle = "#17202a";
    ctx.font = "20px Microsoft YaHei, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(pct(item.risk), x + barW / 2, y - 16);
    ctx.font = "16px Microsoft YaHei, Segoe UI, sans-serif";
    const words = item.label.split("");
    words.forEach((ch, idx) => ctx.fillText(ch, x + barW / 2, area.y + area.h + 22 + idx * 17));
  });
  ctx.textAlign = "left";
}

function runModel() {
  const p = getParams();
  updateLabels(p);

  const queue = simulateQueue(p, 202405);
  const mc = monteCarloQueue(p, 150, 440000);
  const rec = recognition(p);
  const patrolStats = monteCarloPatrol(p.patrols, p.bias, 180, 880000);
  const sample = patrolOnce(p.patrols, p.bias, 990000);

  const altParams = [
    { label: "当前", color: "#245f9d", params: p },
    { label: "错峰", color: "#0f766e", params: { ...p, peak: Math.max(0.70, p.peak * 0.72) } },
    { label: "加通道", color: "#c76528", params: { ...p, gates: Math.min(62, p.gates + 8) } },
    { label: "组合", color: "#2f7d4f", params: { ...p, peak: Math.max(0.70, p.peak * 0.72), gates: Math.min(62, p.gates + 8), bias: Math.min(0.95, p.bias + 0.20) } }
  ];
  const alternatives = altParams.map((item, idx) => ({
    label: item.label,
    color: item.color,
    risk: monteCarloQueue(item.params, 80, 650000 + idx * 3000).risk
  }));

  kpis.maxQueue.textContent = formatInt(queue.maxQueue);
  kpis.riskProb.textContent = pct(mc.risk);
  kpis.avgWait.textContent = queue.avgWait.toFixed(1);
  kpis.ppv.textContent = pct(rec.ppv);
  kpis.hitMedian.textContent = Math.round(patrolStats.median).toString();
  kpis.reviewHours.textContent = formatInt(rec.reviewHours);

  if (mc.risk > 0.55) {
    kpis.verdict.textContent = "尾部拥堵风险偏高";
  } else if (rec.ppv < 0.18) {
    kpis.verdict.textContent = "误报核查压力突出";
  } else if (patrolStats.median > 18) {
    kpis.verdict.textContent = "巡逻发现速度不足";
  } else {
    kpis.verdict.textContent = "方案具有较好冗余";
  }

  drawQueue(document.querySelector("#queueCanvas"), p, queue);
  drawPatrol(document.querySelector("#patrolCanvas"), sample, patrolStats);
  drawDecision(document.querySelector("#decisionCanvas"), alternatives);
}

function setChapter(idx) {
  activeChapter = idx;
  const data = chapters[idx];
  chapterEls.kicker.textContent = data.kicker;
  chapterEls.title.textContent = data.title;
  chapterEls.text.textContent = data.text;
  chapterEls.formula.textContent = data.formula;
  document.querySelectorAll("#chapterTabs button").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.chapter) === idx);
  });
  scheduleUpdate();
}

function applyPreset(name) {
  const preset = presets[name];
  Object.entries(preset).forEach(([key, value]) => {
    controls[key].value = value;
  });
  document.querySelectorAll(".presets button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === name);
  });
  scheduleUpdate();
}

function scheduleUpdate() {
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(runModel, 40);
}

document.querySelectorAll("#chapterTabs button").forEach((btn) => {
  btn.addEventListener("click", () => setChapter(Number(btn.dataset.chapter)));
});

document.querySelectorAll(".presets button").forEach((btn) => {
  btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
});

Object.values(controls).forEach((control) => {
  control.addEventListener("input", () => {
    document.querySelectorAll(".presets button").forEach((btn) => btn.classList.remove("active"));
    scheduleUpdate();
  });
});

applyPreset("baseline");
setChapter(0);
