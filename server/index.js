// Servidor principal: sirve la web pública, el panel /admin y la API del bot.
import express from 'express';
import compression from 'compression';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chatRouter from './routes/chat.js';
import whatsappRouter from './routes/whatsapp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '100kb' }));

// API
app.use('/api', chatRouter);
app.use('/api', whatsappRouter);
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Estáticos con caché agresiva para assets y corta para HTML
const pub = path.join(__dirname, '..', 'public');
app.use(
  express.static(pub, {
    extensions: ['html'],
    setHeaders(res, filePath) {
      if (/\.(png|jpe?g|webp|svg|woff2?)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      } else if (/\.(js|css)$/.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✔ Clínica Silpitucla corriendo en http://localhost:${port}`));
