import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5176 端口：避开 5173/5174/5175
export default defineConfig({
  plugins: [react()],
  server: { port: 5176 },
})
