import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./", // deploys under any subpath (GitHub Pages) without rewriting
  server: { port: 5199 }, // pinned so the README's demo-URL examples are exact
})
