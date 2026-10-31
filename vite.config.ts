import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // true にすると LAN 内の他の端末からも開ける。
    // スマホの実機で確認するために必要（設計書 §9 Week 1 Day 6-7）。
    host: true,
    port: 5173,
  },
});
