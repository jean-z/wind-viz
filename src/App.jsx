import { useRef } from 'react'
import GlobeCanvas from './components/GlobeCanvas.jsx'
import Hud from './components/Hud.jsx'
import Controls from './components/Controls.jsx'

export default function App() {
  const apiRef = useRef(null)
  return (
    <>
      <GlobeCanvas ref={apiRef} />
      <Hud />
      <Controls apiRef={apiRef} />
    </>
  )
}
