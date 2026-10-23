#!/usr/bin/env node
// Apex Sieve 步驟 7：敏感度分析
// 用法：node sensitivity.js <輸入.json> [--out 結果.md]
// 輸入格式見 ../references/sensitivity-input.md。只用 Node 內建模組，不需安裝套件。
'use strict';
const fs = require('fs');

const args = process.argv.slice(2);
if (!args[0]) {
  console.error('用法：node sensitivity.js <輸入.json> [--out 結果.md]');
  process.exit(1);
}
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

const input = JSON.parse(fs.readFileSync(args[0], 'utf8'));
const opt = Object.assign(
  {
    mode: 'weighted', // weighted（加權）或 lexicographic（字典序）
    runs: 2000, // 蒙地卡羅次數
    sigma: 0.2, // 權重對數常態擾動幅度
    seed: 42,
    tieDelta: 0.1, // 分差小於此值視為平手（以 1–5 分制的加權總分計）
    oatFactor: 0.2, // 單一權重擾動 ±20%
    stableAt: 0.8, // 入選率 ≥ 80% 為穩定
    edgeAt: 0.3, // 入選率 30%–80% 為邊緣
  },
  input.options || {}
);

const k = input.k;
const crit = input.criteria;
const cands = input.candidates;
if (!k || !Array.isArray(crit) || !Array.isArray(cands)) {
  console.error('輸入缺少 k、criteria 或 candidates');
  process.exit(1);
}

// ---- 共用工具 ----
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(opt.seed);
function gauss() {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
// 三角分布：在 [lo, hi] 之間、眾數為 mid
function triangular(lo, mid, hi) {
  if (hi <= lo) return mid;
  const u = rand();
  const f = (mid - lo) / (hi - lo);
  return u < f
    ? lo + Math.sqrt(u * (hi - lo) * (mid - lo))
    : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mid));
}
const norm = (w) => {
  const s = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / s);
};
const fmt = (x, d = 2) => Number(x).toFixed(d);

// 分數可以是單一數字，或 [下限, 最可能, 上限]
function range(v) {
  if (Array.isArray(v)) return v.length === 3 ? v : [v[0], v[0], v[0]];
  return [v, v, v];
}
const S = cands.map((c) => crit.map((cr) => range(c.scores[cr.id])));
for (let i = 0; i < cands.length; i++) {
  crit.forEach((cr, j) => {
    if (S[i][j][1] === undefined || Number.isNaN(Number(S[i][j][1]))) {
      console.error(`候選 ${cands[i].id} 缺少準則 ${cr.id} 的分數`);
      process.exit(1);
    }
  });
}
const mid = (i) => S[i].map((r) => r[1]);

// ---- 排名 ----
function weightedRank(scoreRows, w) {
  const tot = scoreRows.map((row) => row.reduce((a, s, j) => a + s * w[j], 0));
  const order = tot.map((t, i) => i).sort((a, b) => tot[b] - tot[a]);
  return { order, tot };
}
function lexRank(scoreRows) {
  const order = scoreRows
    .map((r, i) => i)
    .sort((a, b) => {
      for (let j = 0; j < crit.length; j++) {
        const d = scoreRows[b][j] - scoreRows[a][j];
        if (Math.abs(d) >= opt.tieDelta) return d;
      }
      return 0;
    });
  return { order, tot: null };
}
const rankBy = (rows, w) => (opt.mode === 'lexicographic' ? lexRank(rows) : weightedRank(rows, w));
const topSet = (order) => new Set(order.slice(0, k));
const setKey = (s) => [...s].map((i) => cands[i].id).sort().join('、');

const baseW = norm(crit.map((c) => c.weight ?? 1));
const baseRows = cands.map((c, i) => mid(i));
const base = rankBy(baseRows, baseW);
const baseTop = topSet(base.order);

const lines = [];
const P = (s = '') => lines.push(s);

P('# 敏感度分析結果');
P();
P(`- 模式：${opt.mode === 'lexicographic' ? '字典序（只擾動分數）' : '加權（擾動權重與分數）'}`);
P(`- 候選數：${cands.length}，目標數量 k = ${k}`);
if (cands.length <= k) P('- **注意：候選數不超過 k，全部都會入選，以下分析只能看名次穩定度**');
P(`- 蒙地卡羅次數：${opt.runs}，亂數種子：${opt.seed}，平手門檻 δ = ${opt.tieDelta}`);
if (opt.mode !== 'lexicographic') {
  P(`- 基準權重：${crit.map((c, j) => `${c.id} ${fmt(baseW[j], 3)}`).join('、')}`);
}
P();

// ---- 1. 基準排名 ----
P('## 1. 基準排名');
P();
P('| 名次 | 代號 | 名稱 | 加權總分 | 備註 |');
P('|---|---|---|---|---|');
const kthScore = base.tot ? base.tot[base.order[k - 1]] : null;
base.order.forEach((i, r) => {
  let note = r < k ? '入選' : '';
  if (base.tot && Math.abs(base.tot[i] - kthScore) < opt.tieDelta && base.order[k - 1] !== i) {
    note += (note ? '；' : '') + `與第 ${k} 名平手（差 < δ）`;
  }
  P(`| ${r + 1} | ${cands[i].id} | ${cands[i].name || ''} | ${base.tot ? fmt(base.tot[i]) : '—'} | ${note} |`);
});
P();

// ---- 2. 單一權重擾動 ----
if (opt.mode !== 'lexicographic') {
  P(`## 2. 單一權重擾動（每次只動一條準則 ±${opt.oatFactor * 100}%）`);
  P();
  P('| 準則 | 調整 | 前 k 名 | 和基準相比 |');
  P('|---|---|---|---|');
  crit.forEach((cr, j) => {
    [1 - opt.oatFactor, 1 + opt.oatFactor].forEach((f) => {
      const w = norm(baseW.map((x, jj) => (jj === j ? x * f : x)));
      const t = topSet(rankBy(baseRows, w).order);
      const out = [...baseTop].filter((i) => !t.has(i)).map((i) => cands[i].id);
      const inn = [...t].filter((i) => !baseTop.has(i)).map((i) => cands[i].id);
      const diff = out.length ? `出：${out.join('、')}；進：${inn.join('、')}` : '不變';
      P(`| ${cr.id} ${cr.name || ''} | ×${fmt(f, 1)} | ${setKey(t)} | ${diff} |`);
    });
  });
  P();

  // ---- 3. 翻轉點 ----
  P('## 3. 翻轉點（單一權重放大或縮小到幾倍時，前 k 名開始改變）');
  P();
  P('| 準則 | 往下翻轉倍數 | 往上翻轉倍數 | 解讀 |');
  P('|---|---|---|---|');
  const scan = (j, dir) => {
    for (let s = 1; s <= 60; s++) {
      const f = dir < 0 ? Math.pow(0.95, s) : Math.pow(1.05, s);
      const w = norm(baseW.map((x, jj) => (jj === j ? x * f : x)));
      if (setKey(topSet(rankBy(baseRows, w).order)) !== setKey(baseTop)) return f;
    }
    return null;
  };
  crit.forEach((cr, j) => {
    const dn = scan(j, -1);
    const up = scan(j, 1);
    const near = [dn && dn > 0.7, up && up < 1.3].some(Boolean);
    P(
      `| ${cr.id} ${cr.name || ''} | ${dn ? '×' + fmt(dn) : '未翻轉（≥ ×0.05）'} | ${up ? '×' + fmt(up) : '未翻轉（≤ ×18）'} | ${near ? '**敏感：±30% 內就翻轉**' : '穩健'} |`
    );
  });
  P();

  // ---- 4. 換加權方法 ----
  P('## 4. 換加權方法');
  P();
  P('| 方法 | 權重 | 前 k 名 | 和基準相比 |');
  P('|---|---|---|---|');
  const methods = [['等權重', norm(crit.map(() => 1))]];
  if (crit.every((c) => Number.isInteger(c.rank))) {
    const n = crit.length;
    methods.push(['名次加總（rank-sum）', norm(crit.map((c) => n - c.rank + 1))]);
    methods.push([
      '名次重心（ROC）',
      crit.map((c) => {
        let s = 0;
        for (let j = c.rank; j <= n; j++) s += 1 / j;
        return s / n;
      }),
    ]);
    methods.push(['名次倒數（rank-reciprocal）', norm(crit.map((c) => 1 / c.rank))]);
  }
  methods.forEach(([name, w]) => {
    const t = topSet(rankBy(baseRows, w).order);
    const same = setKey(t) === setKey(baseTop);
    P(`| ${name} | ${w.map((x) => fmt(x, 2)).join(' / ')} | ${setKey(t)} | ${same ? '不變' : '**改變**'} |`);
  });
  P();
}

// ---- 5. 蒙地卡羅 ----
const hit = new Array(cands.length).fill(0);
const ranks = cands.map(() => []);
const sets = new Map();
for (let r = 0; r < opt.runs; r++) {
  const w =
    opt.mode === 'lexicographic' ? baseW : norm(baseW.map((x) => x * Math.exp(opt.sigma * gauss())));
  const rows = S.map((row) => row.map(([lo, m, hi]) => triangular(lo, m, hi)));
  const { order } = rankBy(rows, w);
  order.forEach((i, pos) => ranks[i].push(pos + 1));
  order.slice(0, k).forEach((i) => hit[i]++);
  const key = setKey(new Set(order.slice(0, k)));
  sets.set(key, (sets.get(key) || 0) + 1);
}
const pct = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
P(
  `## ${opt.mode === 'lexicographic' ? '2' : '5'}. 蒙地卡羅（${
    opt.mode === 'lexicographic' ? '' : `權重對數常態擾動 σ = ${opt.sigma}，`
  }分數在 [下限, 上限] 內依三角分布抽樣）`
);
P();
P('| 代號 | 名稱 | 前 k 名入選率 | 平均名次 | 名次 90% 區間 | 分級 |');
P('|---|---|---|---|---|---|');
const byHit = cands.map((c, i) => i).sort((a, b) => hit[b] - hit[a]);
byHit.forEach((i) => {
  const rate = hit[i] / opt.runs;
  const avg = ranks[i].reduce((a, b) => a + b, 0) / ranks[i].length;
  const tier = rate >= opt.stableAt ? '穩定入選' : rate >= opt.edgeAt ? '邊緣' : '偶爾';
  P(
    `| ${cands[i].id} | ${cands[i].name || ''} | ${fmt(rate * 100, 1)}% | ${fmt(avg, 1)} | ${pct(ranks[i], 0.05)}–${pct(ranks[i], 0.95)} | ${tier} |`
  );
});
P();
P('### 最常出現的前 k 名組合');
P();
P('| 組合 | 出現比例 |');
P('|---|---|');
[...sets.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .forEach(([key, n]) => P(`| ${key} | ${fmt((n / opt.runs) * 100, 1)}% |`));
P();

const md = lines.join('\n');
if (outPath) fs.writeFileSync(outPath, md, 'utf8');
process.stdout.write(md + '\n');
