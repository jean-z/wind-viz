/** 左上信息面板 + 左下风速色标（静态内容） */
export default function Hud() {
  return (
    <>
      <aside id="hud">
        <h1>风之镜</h1>
        <p className="sub">全球风场粒子流 · nullschool 风格</p>
        <div className="hud-grid">
          <span className="k">数据</span>
          <span>示例风场（离线）· <a href="https://github.com/cambecc/earth" target="_blank" rel="noreferrer">v2 接 GFS</a></span>
          <span className="k">风带</span>
          <span>信风带 · 盛行西风带 · 极东风带 · 罗斯贝波</span>
          <span className="k">涡旋</span>
          <span>兰金涡旋台风 ×2 · 移动+预报轨迹（不确定度锥）</span>
        </div>
        <p className="hud-note">拖拽旋转 · 滚轮缩放 · 国界：Natural Earth 110m · 台风形态按真实物理构造，位置为演示用</p>
      </aside>
      <div id="legend">
        <span>0</span>
        <div className="bar" />
        <span>45+ m/s</span>
      </div>
    </>
  )
}
