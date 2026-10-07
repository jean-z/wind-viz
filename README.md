# 风之镜 · Wind Mirror

nullschool 风格的全球风场粒子流可视化——**纯 2D Canvas**，零 WebGL 依赖：
拖拽旋转地球，看着信风带、盛行西风带、罗斯贝波和双台风的粒子流在球面上流淌。

"太空科普系列"第四弹（遨游太阳系 → 潜入深渊 → 日月食模拟器 → 风之镜）。

## 运行

```bash
npm install --registry=https://registry.npmmirror.com
npm run dev          # → http://localhost:5176
npm run build        # 静态产出 dist/
node tools/test-field.mjs   # 风场层回归测试（Node 直接跑）
```

## 现在有什么

- **气候学级风场**（离线可跑）：东北信风带 / 盛行西风带 / 极东风带按真实纬度分布，
  中纬度叠加波数 6 的罗斯贝波式经向扰动，ITCZ 赤道辐合
- **双台风 + 预报轨迹**：兰金涡旋模型（眼区风速线性上升、外部 r^-0.5 衰减、北半球逆时针）
  叠加**移动路径模型**（西北向移动 → 中段转向东北的抛物线路径，西太平洋台风典型生命周期）：
  - 白色实心点：过去 3 天历史路径（12h 间隔）
  - 黄色虚线 + 圆圈：未来 120h 预报轨迹（+1d…+5d 标注）
  - **不确定度锥**：横向半宽随预报时效线性增大（气象台预报锥同款画法）
  - 当前中心呼吸圈 + 名称/强度标注；风场随中心移动实时重建（粒子会跟着台风走）
- **nullschool 同款渲染**：粒子存于地理空间每帧平流投影，拖尾画布
  destination-in 淡出；风速色标 蓝→青→绿→黄→橙→红（0–45 m/s）
- **国界/海岸线**：Natural Earth 110m（`world-atlas` 包随构建打包，离线可用），
  大圆插值绘制不糊边
- **交互**：拖拽旋转、滚轮缩放、粒子密度三档、流速三档、视角预设

## v2：接入真实数据（架构已就绪）

`src/wind/field.js` 的网格结构与 [cambecc/earth](https://github.com/cambecc/earth)
的 GFS JSON 完全同构（`[{header:{lo1,la1,nx,ny,dx,dy}}, …]` u/v 两条记录）。
`loadGfsField(url)` 已实现加载器——找一个 GFS→JSON 的转换服务（或自建：
nomads.ncep.noaa.gov 拉取 GRIB2 → grib2json 转换），渲染层零改动即可切换真实风场。

## 架构

```
src/
  wind/field.js        # 风场层：风带/罗斯贝波/兰金涡旋 + 双线性采样 + GFS 适配器（纯函数，Node 可测）
  wind/globe.js        # 渲染层：正交投影 + 粒子平流引擎 + 速度色带（纯类，无框架依赖）
  components/
    GlobeCanvas.jsx    # 双画布挂载 + rAF 循环 + 拖拽/缩放交互
    Hud.jsx            # 信息面板 + 风速色标
    Controls.jsx       # 台风模式 / 密度 / 流速 / 视角
  App.jsx
```

风场与渲染层都是纯模块：`node tools/test-field.mjs` 可脱离浏览器回归测试
（风带方向、半球镜像、台风切向结构 6 项断言）。

## 已知边界

- 示例风场是**气候学+波形合成**，不是某时刻的真实大气——真实数据接入是 v2 主线
- 后台标签页 rAF 冻结属浏览器正常节流
