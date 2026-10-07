// 风场层回归测试：node tools/test-field.mjs
// 校验气候学风带方向与兰金涡旋的切向结构
import { buildProceduralField, sample, defaultField } from '../src/wind/field.js';

const g = buildProceduralField([]);
const fmt = (s) => s ? `u=${s.u.toFixed(1).padStart(6)}  v=${s.v.toFixed(1).padStart(6)}  |v|=${s.speed.toFixed(1)} m/s` : 'null';
let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log(`${cond ? '✅' : '❌'} ${name}`); };

// 1. 东北信风带（15°N 应为东风 u<0）
const trade = sample(g, 150, 15);
console.log('15°N 信风带:', fmt(trade));
check('15°N 为东风（u < -4）', trade.u < -4);

// 2. 盛行西风带（45°N 应为西风 u>0）
const west = sample(g, 150, 45);
console.log('45°N 西风带:', fmt(west));
check('45°N 为西风（u > 6）', west.u > 6);

// 3. 极东风带（75°N u<0）
const polar = sample(g, 150, 75);
console.log('75°N 极东风:', fmt(polar));
check('75°N 为东风（u < 0）', polar.u < 0);

// 4. 台风结构（兰金涡旋）：含台风的字段，按动态模型的当前位置采样
import { DEFAULT_TYPHOONS } from '../src/wind/field.js';
const ty0 = DEFAULT_TYPHOONS[0];
const g2 = defaultField();
const p0 = typhoonPos(ty0, 0);
const eye = sample(g2, p0.lon, p0.lat);                // 台风眼：切向速度趋近 0
const ring = sample(g2, p0.lon + 2.2, p0.lat);         // 眼壁东侧 ~250km：风速最大，方向朝北（逆时针）
console.log('台风眼:', fmt(eye));
console.log('眼壁东侧:', fmt(ring));
check('台风眼风速明显小于眼壁', eye.speed < ring.speed * 0.5);
check('眼壁东侧风向朝北（逆时针切向，v > 10）', ring.v > 10);

// 5. 南半球镜像：15°S 信风仍为东风
const sTrade = sample(g, 150, -15);
console.log('15°S 信风带:', fmt(sTrade));
check('15°S 亦为东风（u < -4）', sTrade.u < -4);

// 6. 台风移动模型：初始向西北偏西（heading 292° → 西分量大、北分量小）
import { typhoonPos, typhoonTrack, makeDynamicField } from '../src/wind/field.js';
const ty = { lon0: 152, lat0: 14, vmax: 45, rmw: 220, heading0: 292, speedKmh: 20, recurveDay: 2.2, recurveDeg: 62 };
const p1 = typhoonPos(ty, 1);
const dLon = p1.lon - ty.lon0, dLat = p1.lat - ty.lat0;
console.log(`1 天后位置: lon ${p1.lon.toFixed(1)}, lat ${p1.lat.toFixed(1)}（Δlon ${dLon.toFixed(1)}°, Δlat ${dLat.toFixed(1)}°）`);
check('向西移动（20km/h ≈ -4°/天，Δlon < -3）', dLon < -3);
check('向北移动（Δlat > 0）', dLat > 0);
const p5 = typhoonPos(ty, 5);
check('转向后纬度加速北上（第 5 天 lat > 第 1 天 lat + 8°）', p5.lat > p1.lat + 8);
const track = typhoonTrack(ty, 0);
check('轨迹采样点数正确（32 = 3 天历史 + 5 天预报 / 0.25 天步长）', track.length === 33);
const df = makeDynamicField();
df.update(2.5);
const pc = typhoonPos(ty, 2.5);
const eyeNow = sample(df, pc.lon, pc.lat);            // 中心（眼）：弱
const wallNow = sample(df, pc.lon + 2.2, pc.lat);     // 眼壁：强
check('动态风场：眼壁风速显著（> 15 m/s）而眼区弱', wallNow.speed > 15 && eyeNow.speed < wallNow.speed * 0.5);

console.log(`\n${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
