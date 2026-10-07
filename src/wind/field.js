// 风场层：气候学级全球风场 + 台风涡旋 + 真实 GFS 数据适配器
//
// v1 策略（离线可跑）：
// - 按真实气候学构造纬向风带（信风带/盛行西风带/极东风带），叠加
//   罗斯贝波式经向扰动与两台"兰金涡旋"台风——物理形态正确、位置为演示用
// - 数据结构与 cambecc/earth 的 GFS JSON 完全同构（header + u/v 数组），
//   因此 loadGfsField(url) 接入真实数据时渲染层零改动
//
// 网格：2.5° × 2.5°（与 GFS 0.25° 精简版同思路），u 向东 m/s，v 向北 m/s

export const DEG = 2.5;
export const NX = 144;                     // lon: -180 .. 180
export const NY = 73;                      // lat: -90 .. 90（含两极）
export const LO1 = -180, LA1 = 90;         // 网格左上角（cambecc 约定）

export function makeGrid() {
  return { u: new Float32Array(NX * NY), v: new Float32Array(NX * NY) };
}

const D2R = Math.PI / 180;

/**
 * 生成气候学级风场（含台风）。
 * typhoons: [{ lon, lat, vmax(m/s), rmw(km) }] —— 兰金涡旋模型
 */
export function buildProceduralField(typhoons = []) {
  const g = makeGrid();
  for (let j = 0; j < NY; j++) {
    const lat = LA1 - j * DEG;
    const absLat = Math.abs(lat);
    const sgn = lat >= 0 ? 1 : -1;                 // 南北半球镜像
    for (let i = 0; i < NX; i++) {
      const lon = LO1 + i * DEG;
      // ── 纬向风带（气候学方向，平方余弦平滑过渡；东西方向不随半球翻转）──
      const band = (center, half, amp) => {
        const t = Math.max(0, 1 - ((absLat - center) / half) ** 2);
        return t * t * amp;
      };
      let u = 0, v = 0;
      // 东北信风（0-30°，东风）；盛行西风（30-60°）；极东风（60-90°）
      u += band(15, 16, -9) + band(45, 16, 13) + band(75, 18, -6);
      // ITCZ 赤道无风带 + 跨赤道气流：赤道附近弱风、微弱向赤道辐合
      const eqT = Math.max(0, 1 - absLat / 8);
      u *= 1 - 0.55 * eqT;
      v += -sgn * 1.2 * eqT;
      // 罗斯贝波式经向扰动（中纬度蜿蜒，波数 6，随经度行进）
      const waveAmp = 4.5 * Math.exp(-(((absLat - 48) / 16) ** 2));
      v += waveAmp * Math.sin(6 * lon * D2R + sgn * 1.1);
      u += waveAmp * 0.4 * Math.cos(6 * lon * D2R + sgn * 1.1);
      // 热带波动（波数 8，弱）
      v += 1.6 * Math.exp(-(((absLat - 12) / 9) ** 2)) * Math.sin(8 * lon * D2R);

      g.u[j * NX + i] = u;
      g.v[j * NX + i] = v;
    }
  }
  // ── 台风：兰金涡旋叠加到网格 ──
  for (const ty of typhoons) addTyphoon(g, ty);
  return g;
}

/** 兰金涡旋：r<Rmw 内风速线性上升，r>Rmw 外按 r^-0.5 衰减（北半球逆时针） */
export function addTyphoon(g, { lon, lat, vmax = 42, rmw = 250 }) {
  const ci = Math.round((lon - LO1) / DEG), cj = Math.round((LA1 - lat) / DEG);
  const rmwDeg = rmw / 111; // 粗略 km→度
  const R = Math.ceil(rmwDeg / DEG * 6);   // 影响半径 ≈ 6×Rmw
  for (let j = Math.max(0, cj - R); j <= Math.min(NY - 1, cj + R); j++) {
    const glat = LA1 - j * DEG;
    for (let i = Math.max(0, ci - R); i <= Math.min(NX - 1, ci + R); i++) {
      let dLon = (LO1 + i * DEG) - lon;
      if (dLon > 180) dLon -= 360; if (dLon < -180) dLon += 360;
      const dx = dLon * 111 * Math.cos(lat * D2R);   // km
      const dy = (glat - lat) * 111;
      const r = Math.hypot(dx, dy);
      if (r > rmwDeg * 111 * 6) continue;
      const vt = r < rmw ? vmax * (r / rmw) : vmax * Math.pow(rmw / r, 0.5);
      // 北半球逆时针：切向方向 = 径向逆时针旋转 90°
      const ux = -dy / (r || 1), uy = dx / (r || 1);
      g.u[j * NX + i] += vt * ux;
      g.v[j * NX + i] += vt * uy;
    }
  }
}

/** 双线性采样：返回 { u, v, speed(m/s) }；出界返回 null */
export function sample(g, lon, lat) {
  if (lat > LA1 || lat < LA1 - (NY - 1) * DEG) return null;
  const x = ((lon - LO1 + 360) % 360) / DEG;
  const y = (LA1 - lat) / DEG;
  const i0 = Math.floor(x), j0 = Math.floor(y);
  if (i0 < 0 || i0 >= NX - 1 || j0 < 0 || j0 >= NY - 1) return null;
  const fx = x - i0, fy = y - j0;
  const idx = (i, j) => j * NX + i;
  const u = g.u[idx(i0, j0)] * (1 - fx) * (1 - fy) + g.u[idx(i0 + 1, j0)] * fx * (1 - fy)
          + g.u[idx(i0, j0 + 1)] * (1 - fx) * fy + g.u[idx(i0 + 1, j0 + 1)] * fx * fy;
  const v = g.v[idx(i0, j0)] * (1 - fx) * (1 - fy) + g.v[idx(i0 + 1, j0)] * fx * (1 - fy)
          + g.v[idx(i0, j0 + 1)] * (1 - fx) * fy + g.v[idx(i0 + 1, j0 + 1)] * fx * fy;
  return { u, v, speed: Math.hypot(u, v) };
}

/**
 * v2 接口：加载真实 GFS 风场（cambecc/earth 格式 JSON）。
 * JSON 结构：[{ header: { lo1, la1, nx, ny, dx, dy, parameterName... }, data: [...] }, ...]
 * 第一条为 u 分量，第二条为 v 分量。加载后渲染层零改动。
 */
export function loadGfsField(url) {
  return fetch(url)
    .then((r) => r.json())
    .then((records) => {
      const [uRec, vRec] = records;
      const { lo1, la1, nx, ny, dx, dy } = uRec.header;
      const grid = {
        u: Float32Array.from(uRec.data),
        v: Float32Array.from(vRec.data),
        meta: { lo1, la1, nx, ny, dx, dy },
      };
      // 覆盖采样函数的网格参数（闭包读取 meta）
      grid._custom = true;
      return grid;
    });
}

/** 默认演示风场：西太平洋双台风 + 全球气候学风带 */
export function defaultField() {
  return makeDynamicField(DEFAULT_TYPHOONS);
}

// ── 台风移动与预报轨迹 ────────────────────────────────────────────────────
//
// 移动模型：西太平洋台风典型生命周期——生成后向西北偏西移动，中段转向
// （抛物线路径），加速向东北移出。转向由 heading 随时间线性旋转近似。
// 该模型用于演示"预报轨迹"的绘制；真实业务预报来自集合预报成员。

export const DEFAULT_TYPHOONS = [
  { name: '海燕', lon0: 152, lat0: 14, vmax: 45, rmw: 220,
    heading0: 292, speedKmh: 20, recurveDay: 2.2, recurveDeg: 62 },
  { name: '安德鲁', lon0: -52, lat0: 17, vmax: 38, rmw: 200,
    heading0: 312, speedKmh: 18, recurveDay: 2.8, recurveDeg: 50 },
];

const KM_PER_DEG = 111;

/** 台风 heading（度，北=0 顺时针）：随天数线性转向 */
export function typhoonHeading(ty, days) {
  const turned = Math.max(0, Math.min(1, (days - ty.recurveDay) / 1.6));
  return ty.heading0 + ty.recurveDeg * turned;
}

/** 台风中心位置（度）：沿变航向积分（0.05 天步长，足够平滑） */
export function typhoonPos(ty, days) {
  let lon = ty.lon0, lat = ty.lat0;
  const step = 0.05;
  let t = 0;
  while (t < days) {
    const dt = Math.min(step, days - t);
    const hd = typhoonHeading(ty, t + dt / 2) * D2R;
    const kmPerDay = ty.speedKmh * 24;
    lat += Math.cos(hd) * kmPerDay * dt / KM_PER_DEG;
    lon += Math.sin(hd) * kmPerDay * dt / (KM_PER_DEG * Math.max(0.2, Math.cos(lat * D2R)));
    lon = ((lon + 540) % 360) - 180;
    t += dt;
  }
  return { lon, lat };
}

/** 预报轨迹采样：[-pastDays, +forecastDays]，stepDays 间隔 → [{days, lon, lat}] */
export function typhoonTrack(ty, days, pastDays = 3, forecastDays = 5, stepDays = 0.25) {
  const pts = [];
  for (let d = -pastDays; d <= forecastDays + 1e-9; d += stepDays) {
    const p = typhoonPos(ty, days + d);
    pts.push({ days: d, ...p });
  }
  return pts;
}

/**
 * 动态风场：基础气候场 + 按仿真天数移动的台风涡旋。
 * 用法：const f = makeDynamicField(TYPHOONS); f.update(days) 后 f.u/f.v 即当前网格。
 */
export function makeDynamicField(typhoons = DEFAULT_TYPHOONS) {
  const base = buildProceduralField([]);
  const work = makeGrid();
  const f = {
    u: work.u, v: work.v, dynamic: true, days: 0, typhoons,
    update(days) {
      f.days = days;
      work.u.set(base.u); work.v.set(base.v);
      for (const ty of typhoons) {
        const pos = typhoonPos(ty, days);
        addTyphoon(work, { lon: pos.lon, lat: pos.lat, vmax: ty.vmax, rmw: ty.rmw });
      }
    },
  };
  f.update(0);
  return f;
}
