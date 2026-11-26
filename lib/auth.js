// Núcleo de seguridad: contraseñas, tokens JWT, sesiones y bitácora.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { query } from './db.js';
import { leerCookies, cookie, agregarCookies, ipDe, ErrorHttp } from './http.js';

export const COOKIE_ACCESO = 'hb_access';
export const COOKIE_SESION = 'hb_refresh';
export const MIN_ACCESO = 15;                       // vigencia del token de acceso
export const HORAS_SESION = 8;                      // sesión normal
export const DIAS_RECORDAR = 30;                    // sesión con "Recordarme"
export const ROLES_SESION_UNICA = ['admin', 'veterinario'];
const MAX_INTENTOS = 5;
const MIN_BLOQUEO = 15;
// Hash falso para que el tiempo de respuesta no revele si el usuario existe.
const HASH_FALSO = bcrypt.hashSync('no-existe', 10);

const secreto = () => {
  if (!process.env.JWT_SECRET) throw new Error('Falta la variable de entorno JWT_SECRET');
  return new TextEncoder().encode(process.env.JWT_SECRET);
};

export const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
export const aleatorio = (n = 32) => crypto.randomBytes(n).toString('base64url');

export function validarPassword(p) {
  if (typeof p !== 'string' || p.length < 8 || !/[A-Z]/.test(p) || !/[a-z]/.test(p) || !/\d/.test(p) || !/[^A-Za-z0-9]/.test(p)) {
    throw new ErrorHttp(400, 'La contraseña debe tener al menos 8 caracteres, mayúscula, minúscula, número y símbolo');
  }
}

export const normalizarRespuesta = (r) => String(r || '').trim().toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '');

export async function registrarEvento(usuarioId, tipo, detalle, req) {
  await query('INSERT INTO eventos (usuario_id, tipo, detalle, ip) VALUES ($1,$2,$3,$4)',
    [usuarioId, tipo, detalle || null, req ? ipDe(req) : null]);
}

// ---------- Tokens JWT ----------
export async function firmar(payload, minutos) {
  return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime(`${minutos}m`).sign(secreto());
}
export async function verificar(token) {
  const { payload } = await jwtVerify(token, secreto(), { algorithms: ['HS256'] });
  return payload;
}

async function emitirAcceso(res, usuario, sesionId) {
  const jwt = await firmar({ sub: String(usuario.id), rol: usuario.rol, nombre: usuario.nombre, sid: sesionId, tipo: 'acceso' }, MIN_ACCESO);
  agregarCookies(res, [cookie(COOKIE_ACCESO, jwt, { maxAge: MIN_ACCESO * 60 })]);
}

// ---------- Inicio de sesión ----------
export async function buscarPorIdentificador(identificador) {
  const id = String(identificador || '').trim().toLowerCase();
  const campo = id.includes('@') ? 'correo' : 'usuario';
  const { rows } = await query(`SELECT * FROM usuarios WHERE ${campo} = $1`, [id]);
  return rows[0];
}

export async function comprobarCredenciales(identificador, password, req) {
  const u = await buscarPorIdentificador(identificador);
  const generico = new ErrorHttp(401, 'Usuario/correo o contraseña incorrectos', 'CREDENCIALES');
  if (!u) { await bcrypt.compare(password || '', HASH_FALSO); throw generico; }
  if (!u.activo) throw new ErrorHttp(403, 'La cuenta está desactivada. Contacta al administrador.', 'INACTIVO');
  if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
    const min = Math.ceil((new Date(u.bloqueado_hasta) - new Date()) / 60000);
    throw new ErrorHttp(423, `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${min} min.`, 'BLOQUEADO');
  }
  const ok = await bcrypt.compare(password || '', u.password_hash);
  if (!ok) {
    const intentos = u.intentos_fallidos + 1;
    const bloquear = intentos >= MAX_INTENTOS;
    await query(`UPDATE usuarios SET intentos_fallidos = $2,
                 bloqueado_hasta = CASE WHEN $3 THEN now() + interval '${MIN_BLOQUEO} minutes' ELSE bloqueado_hasta END
                 WHERE id = $1`, [u.id, bloquear ? 0 : intentos, bloquear]);
    await registrarEvento(u.id, bloquear ? 'CUENTA_BLOQUEADA' : 'LOGIN_FALLIDO', `Intento ${intentos}`, req);
    throw generico;
  }
  await query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
  return u;
}

export async function crearSesion(req, res, usuario, recordar) {
  // Política de sesión única para personal: un nuevo inicio cierra las demás sesiones.
  if (ROLES_SESION_UNICA.includes(usuario.rol)) {
    const r = await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'reemplazada'
                           WHERE usuario_id = $1 AND revocada_en IS NULL AND expira_en > now()`, [usuario.id]);
    if (r.rowCount) await registrarEvento(usuario.id, 'SESION_REEMPLAZADA', `${r.rowCount} sesión(es) cerrada(s) por inicio único`, req);
  }
  const id = crypto.randomUUID();
  const token = aleatorio();
  const horas = recordar ? DIAS_RECORDAR * 24 : HORAS_SESION;
  await query(`INSERT INTO sesiones (id, usuario_id, token_hash, recordar, agente, ip, expira_en)
               VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval)`,
  [id, usuario.id, sha256(token), !!recordar, (req.headers['user-agent'] || '').slice(0, 250), ipDe(req), String(horas)]);
  agregarCookies(res, [cookie(COOKIE_SESION, `${id}.${token}`, { maxAge: recordar ? horas * 3600 : undefined })]);
  await emitirAcceso(res, usuario, id);
  await registrarEvento(usuario.id, 'LOGIN_EXITOSO', recordar ? 'Con "Recordarme"' : null, req);
  return id;
}

export function limpiarCookies(res) {
  agregarCookies(res, [cookie(COOKIE_ACCESO, '', { borrar: true }), cookie(COOKIE_SESION, '', { borrar: true })]);
}

// ---------- Recuperación de sesión (rotación del token de sesión) ----------
export async function renovarSesion(req, res) {
  const raw = leerCookies(req)[COOKIE_SESION];
  if (!raw || !raw.includes('.')) return { ok: false, motivo: 'sin_sesion' };
  const [id, token] = raw.split('.');
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, motivo: 'sin_sesion' };
  const { rows } = await query(`SELECT s.*, u.rol, u.nombre, u.activo FROM sesiones s
                                JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = $1`, [id]);
  const s = rows[0];
  if (!s) { limpiarCookies(res); return { ok: false, motivo: 'sin_sesion' }; }
  if (s.revocada_en) { limpiarCookies(res); return { ok: false, motivo: s.motivo || 'revocada' }; }
  if (new Date(s.expira_en) < new Date()) { limpiarCookies(res); return { ok: false, motivo: 'expirada' }; }
  if (!s.activo) { limpiarCookies(res); return { ok: false, motivo: 'inactivo' }; }
  if (s.token_hash !== sha256(token)) {
    // Token viejo reutilizado: posible robo de cookie. Se revoca la sesión completa.
    await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'reuso_token' WHERE id = $1`, [id]);
    await registrarEvento(s.usuario_id, 'ALERTA_REUSO_TOKEN', `Sesión ${id} revocada`, req);
    limpiarCookies(res);
    return { ok: false, motivo: 'reuso_token' };
  }
  const nuevo = aleatorio();
  // Sesión normal: vencimiento deslizante. Con "Recordarme": se conserva la fecha original.
  await query(`UPDATE sesiones SET token_hash = $2, ultimo_uso = now(),
               expira_en = CASE WHEN recordar THEN expira_en ELSE now() + interval '${HORAS_SESION} hours' END
               WHERE id = $1`, [id, sha256(nuevo)]);
  const maxAge = s.recordar ? Math.floor((new Date(s.expira_en) - new Date()) / 1000) : undefined;
  agregarCookies(res, [cookie(COOKIE_SESION, `${id}.${nuevo}`, { maxAge })]);
  await emitirAcceso(res, { id: s.usuario_id, rol: s.rol, nombre: s.nombre }, id);
  return { ok: true, usuario: { id: s.usuario_id, rol: s.rol, nombre: s.nombre } };
}

export async function revocarSesion(id, motivo) {
  await query(`UPDATE sesiones SET revocada_en = now(), motivo = $2 WHERE id = $1 AND revocada_en IS NULL`, [id, motivo]);
}

// ---------- Protección de la API por roles ----------
export async function autenticar(req, rolesPermitidos) {
  const token = leerCookies(req)[COOKIE_ACCESO];
  if (!token) throw new ErrorHttp(401, 'Sesión requerida', 'TOKEN_AUSENTE');
  let p;
  try { p = await verificar(token); } catch { throw new ErrorHttp(401, 'Token expirado', 'TOKEN_EXPIRADO'); }
  if (p.tipo !== 'acceso') throw new ErrorHttp(401, 'Token inválido', 'TOKEN_INVALIDO');
  // Se valida contra la BD para que una sesión cerrada deje de funcionar de inmediato.
  const { rows } = await query(`SELECT s.revocada_en, s.motivo, s.expira_en, u.* FROM sesiones s
                                JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = $1`, [p.sid]);
  const r = rows[0];
  if (!r || r.revocada_en || new Date(r.expira_en) < new Date() || !r.activo) {
    throw new ErrorHttp(401, 'La sesión fue cerrada', r?.motivo === 'reemplazada' ? 'SESION_REEMPLAZADA' : 'SESION_CERRADA');
  }
  if (rolesPermitidos && !rolesPermitidos.includes(r.rol)) {
    await registrarEvento(r.id, 'ACCESO_DENEGADO', `${req.method} ${req.url}`, req);
    throw new ErrorHttp(403, 'No tienes permiso para esta acción', 'ROL');
  }
  return { ...r, sid: p.sid };
}

export const publico = (u) => ({
  id: u.id, usuario: u.usuario, correo: u.correo, nombre: u.nombre, telefono: u.telefono,
  rol: u.rol, mfa_activo: u.mfa_activo, tiene_pregunta: !!u.pregunta,
});

// ---------- Cifrado del secreto MFA (AES-256-GCM) ----------
const llaveMfa = () => crypto.createHash('sha256').update('mfa:' + process.env.JWT_SECRET).digest();
export function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', llaveMfa(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString('base64url')).join('.');
}
export function descifrar(paquete) {
  const [iv, tag, datos] = paquete.split('.').map((p) => Buffer.from(p, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', llaveMfa(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

export const destinoPorRol = (rol) => ({ admin: '/admin/', veterinario: '/veterinario/', cliente: '/cliente/' }[rol] || '/');
