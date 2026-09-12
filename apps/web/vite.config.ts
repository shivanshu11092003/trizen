import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787', '/img': 'http://localhost:8787' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('/antd/') || id.includes('@ant-design')) return 'admin-kit';
          if (id.includes('input-otp') || id.includes('sonner')) return 'gallery-kit';
        },
      },
    },
  },
});
