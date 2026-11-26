// Servidor local para desarrollo: imita el comportamiento de Vercel (middleware + /api + archivos estáticos).
// Uso: DATABASE_URL=... JWT_SECRET=... COOKIE_INSEGURA=1 npm run dev
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import middleware, { config } from './middleware.js';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

// Encabezados de seguridad definidos en vercel.json
const { headers } = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
app.use((req, res, siguiente) => { for (const h of headers[0].headers) res.set(h.key, h.value); siguiente(); });

// 1) Routing Middleware (protección de rutas por rol)
const patrones = config.matcher.map((m) => new RegExp('^' + m.replace('/:path*', '(/.*)?') + '$'));
app.use(async (req, res, siguiente) => {
  if (!patrones.some((p) => p.test(req.path))) return siguiente();
  const request = new Request(`http://${req.headers.host}${req.originalUrl}`, { headers: req.headers });
  const r = await middleware(request);
  if (r.headers.get('x-middleware-next')) return siguiente();
  res.status(r.status).set('Location', r.headers.get('location')).end();
});

// 2) Funciones /api/<grupo>/<accion>
const grupos = {};
for (const g of ['auth', 'cuenta', 'admin', 'clinica']) grupos[g] = (await import(`./api/${g}/[accion].js`)).default;
app.all('/api/:grupo/:accion', (req, res) => {
  const fn = grupos[req.params.grupo];
  if (!fn) return res.status(404).json({ error: 'No encontrado' });
  req.query.accion = req.params.accion;
  fn(req, res);
});

// 3) Archivos estáticos con "cleanUrls"
app.use(express.static(path.join(raiz, 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(raiz, 'public', '404.html')));

const puerto = process.env.PORT || 3000;
app.listen(puerto, () => console.log(`Huellas del Bravo en http://localhost:${puerto}`));
