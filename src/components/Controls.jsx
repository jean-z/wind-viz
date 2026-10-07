import { useState } from 'react'

const DENSITIES = [['低', 2500], ['中', 5000], ['高', 10000]]
const SPEEDS = [['慢', 0.5], ['标准', 1], ['快', 2]]
const VIEWS = [['西太平洋', 138, 21], ['中国', 105, 33], ['大西洋', -60, 25], ['印度洋', 78, -12]]

/** 底部控制条：台风模式 / 粒子密度 / 流速 / 视角 */
export default function Controls({ apiRef }) {
  const [typhoons, setTyphoons] = useState(true)
  const [density, setDensity] = useState('中')
  const [speed, setSpeed] = useState('标准')

  return (
    <div id="controls">
      <button
        className={`ctl typhoon ${typhoons ? 'on' : ''}`}
        onClick={() => { const on = !typhoons; setTyphoons(on); apiRef.current?.setTyphoons(on) }}
      >
        🌀 台风模式
      </button>
      <div className="sep" />
      <span className="k">粒子</span>
      {DENSITIES.map(([label, n]) => (
        <button key={label} className={`ctl ${density === label ? 'on' : ''}`}
          onClick={() => { setDensity(label); apiRef.current?.setDensity(n) }}>{label}</button>
      ))}
      <div className="sep" />
      <span className="k">流速</span>
      {SPEEDS.map(([label, v]) => (
        <button key={label} className={`ctl ${speed === label ? 'on' : ''}`}
          onClick={() => { setSpeed(label); apiRef.current?.setSimSpeed(v) }}>{label}</button>
      ))}
      <div className="sep" />
      {VIEWS.map(([label, lon, lat]) => (
        <button key={label} className="ctl" onClick={() => apiRef.current?.rotateTo(lon, lat)}>{label}</button>
      ))}
    </div>
  )
}
