import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))
const coreSrc = resolve(__dirname, '../core/src/index.ts')
const { version } = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf-8')) as { version: string }

/** Single folder at repo root to copy to another machine (static files only; no sample data). */
const staticAppOutDir = resolve(__dirname, '../static-app')

function deployReadmePlugin(): Plugin {
  let outDir = staticAppOutDir
  return {
    name: 'nonsheet-finance-deploy-readme',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const text = `Nonsheet Finance — static build (package ${version})
================================================================

This folder is the complete built app. Copy it anywhere (USB drive, network
folder, static web host). It does not include your wealth data JSON; use the
in-app menu to Import a .json file or start empty.

Preview on a PC (needs Node.js):
  cd this folder
  npx --yes serve -s .

Then open the URL shown (e.g. http://localhost:3000). The app uses hash routes
(#/...) so a static file server without SPA rewrites is fine.

There is no service worker: offline caching is not provided; Add to Home Screen
uses the web app manifest only.

You can also open index.html directly; if the browser blocks features under
file://, use "serve" as above instead.
`
      writeFileSync(join(outDir, 'README.txt'), text, 'utf-8')
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    outDir: staticAppOutDir,
    emptyOutDir: true,
  },
  plugins: [deployReadmePlugin(), react()],
  resolve: {
    alias: {
      '@nonsheet-finance/core': coreSrc,
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: parseInt(process.env.VITE_PORT ?? '5174'),
    strictPort: true,
  },
})
