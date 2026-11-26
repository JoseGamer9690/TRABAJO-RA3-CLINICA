// Utilidades HTTP compartidas por las funciones de /api.
import { asegurarEsquema } from './db.js';

export function leerCookies(req) {
  const salida = {};
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const k = parte.slice(0, i).trim();
    if (k) salida[k] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

const seguro = process.env.COOKIE_INSEGURA !== '1';

export function cookie(nombre, valor, { maxAge, borrar } = {}) {
  let c = `${nombre}=${borrar ? '' : encodeURIComponent(valor)}; Path=/; HttpOnly; SameSite=Lax`;
  if (seguro) c += '; Secure';
  if (borrar) c += '; Max-Age=0';
  else if (maxAge) c += `; Max-Age=${maxAge}`;
  return c;
}

export function agregarCookies(res, lista) {
  const prev = res.getHeader('Set-Cookie');
  const actuales = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  res.setHeader('Set-Cookie', [...actuales, ...lista]);
}

export function ipDe(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
}

export function enviar(res, status, datos) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(datos));
}

export class ErrorHttp extends Error {
  constructor(status, mensaje, codigo) { super(mensaje); this.status = status; this.codigo = codigo; }
}

// Protección CSRF: las peticiones que modifican datos deben venir del mismo origen.
function validarOrigen(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origen = req.headers.origin;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (origen && new URL(origen).host !== host) throw new ErrorHttp(403, 'Origen no permitido', 'CSRF');
}

// Envuelve cada función: crea el esquema, enruta por "accion" y maneja errores.
export function enrutador(rutas) {
  return async (req, res) => {
    try {
      await asegurarEsquema();
      validarOrigen(req);
      const accion = req.query?.accion || new URL(req.url, 'http://x').pathname.split('/').pop();
      const ruta = rutas[`${req.method} ${accion}`];
      if (!ruta) throw new ErrorHttp(404, 'Ruta no encontrada');
      if (typeof req.body === 'string') { try { req.body = JSON.parse(req.body); } catch { req.body = {}; } }
      req.body = req.body || {};
      await ruta(req, res);
    } catch (e) {
      if (e instanceof ErrorHttp) return enviar(res, e.status, { error: e.message, codigo: e.codigo });
      console.error(e);
      enviar(res, 500, { error: 'Error interno del servidor' });
    }
  };
}

export function requerir(body, campos) {
  for (const c of campos) {
    if (body[c] === undefined || body[c] === null || String(body[c]).trim() === '') {
      throw new ErrorHttp(400, `Falta el campo: ${c}`);
    }
  }
}
