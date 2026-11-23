import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        // electron-updater is CommonJS with dynamic requires; the document parsers are loaded
        // at runtime from node_modules (pdfjs-dist is ESM with its own worker file).
        external: ['electron-updater', 'mammoth', 'pdfjs-dist', /^pdfjs-dist\//]
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          switcher: resolve('src/preload/switcher.ts'),
          tree: resolve('src/preload/tree.ts'),
          'chatgpt-web': resolve('src/preload/chatgpt-web.ts'),
          projector: resolve('src/preload/projector.ts')
        }
      }
    }
  },
  renderer: {
    assetsInclude: ['**/*.glb'],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          preview: resolve('src/renderer/preview.html'),
          living: resolve('src/renderer/living.html'),
          motion: resolve('src/renderer/motion.html'),
          switcher: resolve('src/renderer/switcher.html'),
          tree: resolve('src/renderer/tree.html'),
          'gpt-live': resolve('src/renderer/gpt-live.html'),
          'chatgpt-web': resolve('src/renderer/chatgpt-web.html'),
          projector: resolve('src/renderer/projector.html')
        }
      }
    }
  }
})
