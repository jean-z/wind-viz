// 渲染层：正交投影地球 + 粒子平流引擎（2D Canvas，nullschool 同款路线）
//
// 设计原则：
// - 粒子存储在地理空间（lon/lat），每帧用风场平流后投影绘制——投影正确性优先，
//   日界线穿越天然正确；单帧 5000 粒子的三角函数开销在 2D canvas 绘制成本之下
// - 基础地球（球体/经纬网）只在视角变化时重绘；拖尾画布每帧
//   destination-in 淡出 + 叠加新线段，合成出"风的尾巴"
// - 对外暴露极小的命令式 API，React 只管挂载与控制条

import { sample, LO1, LA1, DEG, NX, NY, typhoonTrack, typhoonPos } from './field.js';
import { feature } from 'topojson-client';
import countriesTopo from 'world-atlas/countries-110m.json';

const D2R = Math.PI / 180;

/* ── 国界/海岸线数据（Natural Earth 110m，随构建打包，离线可用）──────── */
let _rings = null;
function outlineRings() {
  if (_rings) return _rings;
  const fc = feature(countriesTopo, countriesTopo.objects.countries);
  const rings = [];
  for (const f of fc.features) {
    const gm = f.geometry;
    if (!gm) continue;
    const polys = gm.type === 'Polygon' ? [gm.coordinates]
      : gm.type === 'MultiPolygon' ? gm.coordinates : [];
    for (const poly of polys) for (const ring of poly) rings.push(ring);
  }
  _rings = rings;
  return rings;
}

/** 球面两点间按 ~1.5° 步长插值，避免大圆弧画成直线 */
function slerpPath(ring) {
  const toVec = ([lo, la]) => {
    const p = la * D2R, l = lo * D2R;
    return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
  };
  const toLL = (v) => [Math.atan2(v[1], v[0]) / D2R, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D2R];
  const out = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const a = toVec(ring[i - 1]), b = toVec(ring[i]);
    const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
    const ang = Math.acos(dot) / D2R;
    const n = Math.min(24, Math.ceil(ang / 1.5));
    for (let k = 1; k <= n; k++) {
      const t = k / n, s = Math.sin(ang * D2R);
      const w1 = s === 0 ? 1 - t : Math.sin((1 - t) * ang * D2R) / s;
      const w2 = s === 0 ? t : Math.sin(t * ang * D2R) / s;
      out.push(toLL([a[0] * w1 + b[0] * w2, a[1] * w1 + b[1] * w2, a[2] * w1 + b[2] * w2]));
    }
  }
  return out;
}

/** 风速 → 颜色（nullschool 同款色带：蓝→青→绿→黄→橙→红） */
const STOPS = [
  [0, [44, 95, 138]], [5, [59, 158, 158]], [10, [143, 209, 79]],
  [18, [242, 208, 72]], [28, [242, 128, 58]], [45, [232, 58, 58]],
];
export function speedColor(v) {
  if (v <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 1; i < STOPS.length; i++) {
    if (v <= STOPS[i][0]) {
      const [v0, c0] = STOPS[i - 1], [v1, c1] = STOPS[i];
      const k = (v - v0) / (v1 - v0);
      return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export class WindGlobe {
  constructor(baseCanvas, trailCanvas, trackCanvas, field) {
    this.base = baseCanvas.getContext('2d');
    this.trail = trailCanvas.getContext('2d');
    this.track = trackCanvas?.getContext('2d') ?? null;
    this.field = field;
    this.lon0 = -140;      // 视角中心（默认面向西太平洋台风）
    this.lat0 = 22;
    this.scale = 1;        // 半径倍率
    this.particleCount = 5000;
    this.particles = [];
    this.viewDirty = true;
    this.simSpeed = 1;     // 时间流速倍率（1 = 演示基准流场）
    this.typhoonsOn = true;
    this.resize();
    this.spawnAll();
  }

  resize() {
    const b = this.base.canvas, t = this.trail.canvas, k = this.track?.canvas;
    const w = b.clientWidth || innerWidth, h = b.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    for (const c of [b, t, k].filter(Boolean)) { c.width = w * dpr; c.height = h * dpr; }
    this.base.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.trail.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.track) this.track.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.R = Math.min(w, h) * 0.42 * this.scale;
    this.cx = w / 2; this.cy = h / 2;
    this.viewDirty = true;
  }

  setScale(k) { this.scale = Math.max(0.6, Math.min(4, this.scale * k)); this.resize(); }

  rotateBy(dLon, dLat) {
    this.lon0 -= dLon;
    this.lat0 = Math.max(-85, Math.min(85, this.lat0 + dLat));
    this.viewDirty = true;
  }

  setField(f) { this.field = f; this.spawnAll(); }
  setDensity(n) { this.particleCount = n; this.spawnAll(); }

  /* ── 投影 ────────────────────────────────────────────────────────── */
  project(lon, lat) {
    const l = (lon - this.lon0) * D2R, p = lat * D2R, p0 = this.lat0 * D2R;
    const cosc = Math.cos(p) * Math.cos(l);
    if (cosc < 0) return null;                     // 背面
    const x = this.cx + this.R * Math.cos(p) * Math.sin(l);
    const y = this.cy - this.R * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(l));
    return { x, y };
  }

  /* ── 粒子 ────────────────────────────────────────────────────────── */
  respawn(p) {
    p.lon = -180 + Math.random() * 360;
    p.lat = Math.asin(2 * Math.random() - 1) / D2R;
    p.age = 40 + Math.random() * 110;
    p.px = null;
  }

  spawnAll() {
    this.particles = Array.from({ length: this.particleCount }, () => {
      const p = {}; this.respawn(p); p.age = Math.random() * 140; return p;
    });
  }

  /** 每帧：淡出拖尾 → 平流 → 画线段；动态风场推进台风并绘制预报轨迹 */
  frame(dt = 1) {
    const { trail, w, h } = this;
    if (this.field.dynamic) {
      this.field.days += dt * 0.0042;          // ≈0.25 天/秒：120h 预报约 20 秒展开
      this.field.update(this.field.days);
    }
    if (this.viewDirty) { this.drawBase(); this.trail.clearRect(0, 0, w, h); this.viewDirty = false; }

    // 拖尾淡出（destination-in 保持透明背景，可叠加在地球之上）
    trail.globalCompositeOperation = 'destination-in';
    trail.fillStyle = 'rgba(0,0,0,0.935)';
    trail.fillRect(0, 0, w, h);
    trail.globalCompositeOperation = 'source-over';
    trail.lineCap = 'round';

    const K = 0.0135 * this.simSpeed;   // 平流系数：m/s → 度/帧
    for (const p of this.particles) {
      const w0 = sample(this.field, p.lon, p.lat);
      if (!w0) { this.respawn(p); continue; }
      const cosLat = Math.max(0.15, Math.cos(p.lat * D2R));
      const nLon = p.lon + (w0.u * K) / cosLat;
      const nLat = p.lat + w0.v * K;
      const a = this.project(p.lon, p.lat);
      const b = this.project(((nLon + 540) % 360) - 180, nLat);
      p.lon = ((nLon + 540) % 360) - 180;
      p.lat = nLat;
      p.age -= dt;
      if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) > 40) { this.respawn(p); continue; }
      if (p.age <= 0) { this.respawn(p); continue; }
      const c = speedColor(w0.speed);
      trail.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},0.85)`;
      trail.lineWidth = 1.15;
      trail.beginPath();
      trail.moveTo(a.x, a.y);
      trail.lineTo(b.x, b.y);
      trail.stroke();
    }

    // 台风预报轨迹（独立轨迹层，每帧重绘，跟随视角）
    if (this.track) this.drawTracks();
  }

  /** 台风历史路径（实线）+ 预报轨迹（虚线/24h圈）+ 不确定度锥 + 当前中心 */
  drawTracks() {
    const ctx = this.track;
    if (!this.field.dynamic) { ctx.clearRect(0, 0, this.w, this.h); return; }
    ctx.clearRect(0, 0, this.w, this.h);

    for (const ty of this.field.typhoons) {
      const proj = typhoonTrack(ty, this.field.days).map((p) => ({ ...p, s: this.project(p.lon, p.lat) }));

      // ── 不确定度锥（预报段）：横向半宽随时效增大 ──
      const fc = proj.filter((p) => p.days >= 0 && p.s);
      if (fc.length > 4) {
        const halfWpx = (d) => (0.3 + 0.32 * d) * 2.5 * D2R * this.R;
        const side = (sign) => fc.map((p, i) => {
          const q = fc[Math.min(fc.length - 1, i + 1)], r = fc[Math.max(0, i - 1)];
          let dx = q.s.x - r.s.x, dy = q.s.y - r.s.y;
          const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
          const wpx = halfWpx(p.days);
          return [p.s.x - dy * wpx * sign, p.s.y + dx * wpx * sign];
        });
        const poly = [...side(1), ...side(-1).reverse()];
        ctx.beginPath();
        poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,210,122,0.10)';
        ctx.fill();
      }

      // ── 历史路径：实线 + 12h 间隔点 ──
      ctx.strokeStyle = 'rgba(255,255,255,.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let pen = false;
      for (const p of proj) {
        if (p.days > 0 || !p.s) { pen = false; continue; }
        pen ? ctx.lineTo(p.s.x, p.s.y) : ctx.moveTo(p.s.x, p.s.y);
        pen = true;
      }
      ctx.stroke();
      for (const p of proj) {
        if (p.days > 0 || !p.s || Math.round(p.days * 4) % 2 !== 0 || Math.abs(p.days * 4 - Math.round(p.days * 4)) > 1e-6) continue;
        ctx.beginPath(); ctx.arc(p.s.x, p.s.y, 1.8, 0, 7);
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
      }

      // ── 预报轨迹：虚线 + 24h 圈 + 时效标注 ──
      ctx.strokeStyle = '#ffd27a';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      pen = false;
      for (const p of proj) {
        if (p.days < 0 || !p.s) { pen = false; continue; }
        pen ? ctx.lineTo(p.s.x, p.s.y) : ctx.moveTo(p.s.x, p.s.y);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '10px -apple-system, "PingFang SC", sans-serif';
      for (const p of proj) {
        if (p.days <= 0 || !p.s || p.days % 1 > 1e-6) continue;
        ctx.beginPath(); ctx.arc(p.s.x, p.s.y, 2.8, 0, 7);
        ctx.strokeStyle = '#ffd27a'; ctx.stroke();
        ctx.fillStyle = '#ffd27a';
        ctx.fillText(`+${Math.round(p.days)}d`, p.s.x + 6, p.s.y - 5);
      }

      // ── 当前中心：实心点 + 呼吸圈 + 名称 ──
      const cur = typhoonPos(ty, this.field.days);
      const c = this.project(cur.lon, cur.lat);
      if (c) {
        const pulse = 5.5 + 2.5 * Math.abs(Math.sin(performance.now() / 380));
        ctx.beginPath(); ctx.arc(c.x, c.y, 3.2, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(c.x, c.y, pulse, 0, 7);
        ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px -apple-system, "PingFang SC", sans-serif';
        ctx.fillText(`${ty.name} · ${ty.vmax} m/s`, c.x + 10, c.y - 8);
      }
    }
  }

  /* ── 基础地球（视角变化时重绘）────────────────────────────────────── */
  drawBase() {
    const { base, w, h, cx, cy, R } = this;
    base.clearRect(0, 0, w, h);

    // 球体
    const rg = base.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R);
    rg.addColorStop(0, '#12365c');
    rg.addColorStop(1, '#04101f');
    base.beginPath(); base.arc(cx, cy, R, 0, Math.PI * 2);
    base.fillStyle = rg; base.fill();
    base.strokeStyle = 'rgba(140,220,255,.45)'; base.lineWidth = 1.4;
    base.shadowColor = 'rgba(120,210,255,.5)'; base.shadowBlur = 24;
    base.stroke(); base.shadowBlur = 0;

    // 经纬网（仅可见半球）
    base.strokeStyle = 'rgba(160,205,226,.13)';
    base.lineWidth = 1;
    const drawLine = (pts) => {
      base.beginPath();
      let pen = false;
      for (const [lon, lat] of pts) {
        const s = this.project(lon, lat);
        if (!s) { pen = false; continue; }
        pen ? base.lineTo(s.x, s.y) : base.moveTo(s.x, s.y);
        pen = true;
      }
      base.stroke();
    };
    const samplePts = (fn) => {
      const pts = [];
      for (let t = -180; t <= 180; t += 3) pts.push(fn(t));
      return pts;
    };
    for (let lon = -180; lon < 180; lon += 30) drawLine(samplePts((t) => [lon, t]));
    for (const lat of [-60, -30, 30, 60]) drawLine(samplePts((t) => [t, lat]));
    // 赤道略亮
    base.strokeStyle = 'rgba(160,205,226,.25)';
    drawLine(samplePts((t) => [t, 0]));

    // 国界/海岸线（Natural Earth 110m）
    base.strokeStyle = 'rgba(200,235,255,.42)';
    base.lineWidth = 1;
    for (const ring of outlineRings()) {
      base.beginPath();
      let pen = false;
      for (const [lo, la] of slerpPath(ring)) {
        const s = this.project(lo, la);
        if (!s) { pen = false; continue; }
        pen ? base.lineTo(s.x, s.y) : base.moveTo(s.x, s.y);
        pen = true;
      }
      base.stroke();
    }
  }
}

export { LO1, LA1, DEG, NX, NY };
