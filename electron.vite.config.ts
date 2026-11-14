import { resolve } from 'path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          switcher: resolve('src/preload/switcher.ts')
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
          switcher: resolve('src/renderer/switcher.html')
        }
      }
    }
  }
})
