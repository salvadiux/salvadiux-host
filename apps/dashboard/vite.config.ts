import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],optimizeDeps:{noDiscovery:true,include:[]},server:{port:5173,proxy:{'/api':{target:'http://127.0.0.1:3210',ws:true}}},build:{outDir:'dist'}});
