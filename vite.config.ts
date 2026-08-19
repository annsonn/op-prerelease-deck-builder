import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export function resolveBasePath(configuredBase: string | undefined): string {
  return configuredBase ?? '/'
}

export default defineConfig({
  base: resolveBasePath(process.env.VITE_BASE_PATH),
  plugins: [react()],
})
