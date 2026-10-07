import { useEffect, useImperativeHandle, useRef } from 'react'
import { WindGlobe } from '../wind/globe.js'
import { defaultField, buildProceduralField, DEFAULT_TYPHOONS, makeDynamicField } from '../wind/field.js'

/** 三层画布：基础地球（底）+ 粒子拖尾（中）+ 台风轨迹（顶）；交互与 rAF 循环都在这里 */
export default function GlobeCanvas({ ref }) {
  const baseRef = useRef(null), trailRef = useRef(null), trackRef = useRef(null), g = useRef(null)

  useEffect(() => {
    const globe = new WindGlobe(baseRef.current, trailRef.current, trackRef.current, defaultField())
    g.current = globe
    window.__wind = globe   // 调试口：window.__wind 状态/投影
    let raf
    let last = performance.now()
    const loop = (now) => {
      const dt = Math.min(3, (now - last) / 16.7)  // 帧率归一
      last = now
      globe.frame(dt)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => globe.resize())
    ro.observe(baseRef.current.parentElement)

    // 拖拽旋转 / 滚轮缩放
    const el = trailRef.current
    let dragging = false, lx = 0, ly = 0
    const down = (e) => { dragging = true; lx = e.clientX; ly = e.clientY; el.setPointerCapture(e.pointerId) }
    const move = (e) => {
      if (!dragging) return
      globe.rotateBy((e.clientX - lx) * 0.24, (e.clientY - ly) * 0.24)
      lx = e.clientX; ly = e.clientY
    }
    const up = () => { dragging = false }
    const wheel = (e) => { e.preventDefault(); globe.setScale(e.deltaY < 0 ? 1.12 : 1 / 1.12) }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    el.addEventListener('wheel', wheel, { passive: false })

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', wheel)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    setDensity(n) { g.current?.setDensity(n) },
    setSimSpeed(v) { if (g.current) g.current.simSpeed = v },
    setTyphoons(on) {
      const globe = g.current
      if (!globe) return
      globe.setField(on
        ? makeDynamicField(DEFAULT_TYPHOONS)
        : buildProceduralField([]))
      globe.spawnAll()
    },
    rotateTo(lon, lat) {
      const globe = g.current
      if (!globe) return
      globe.lon0 = lon; globe.lat0 = lat; globe.viewDirty = true
    },
  }))

  return (
    <div id="globe-wrap">
      <canvas id="globe-base" ref={baseRef} />
      <canvas id="globe-trail" ref={trailRef} />
      <canvas id="globe-track" ref={trackRef} />
    </div>
  )
}
