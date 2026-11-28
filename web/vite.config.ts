import { defineConfig } from 'vite';

export default defineConfig({
  // Servido pelo Nest em /chat.
  base: '/chat/',
  server: {
    // `npm run web:dev`: a API continua no Nest, na porta 3000.
    proxy: { '/simulator': { target: 'http://localhost:3000' } },
  },
});
