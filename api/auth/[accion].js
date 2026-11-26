// /api/auth/* — inicio de sesión, MFA, registro, cierre, renovación y recuperación de contraseña.
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { enrutador, enviar, requerir, ErrorHttp } from '../../lib/http.js';
import {
  comprobarCredenciales, crearSesion, renovarSesion, revocarSesion, limpiarCookies, autenticar,
  firmar, verificar, validarPassword, normalizarRespuesta, registrarEvento, buscarPorIdentificador,
  sha256, aleatorio, publico, destinoPorRol,
} from '../../lib/auth.js';
import { totpValido } from '../../lib/mfa.js';
import { enviarCorreo } from '../../lib/correo.js';

const PREGUNTAS_SEÑUELO = [
  '¿Cuál fue el nombre de tu primera mascota?',
  '¿En qué colonia creciste?',
  '¿Cuál es tu comida favorita?',
];

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default enrutador({
  // 1) Usuario o correo + contraseña
  async 'POST login'(req, res) {
    requerir(req.body, ['identificador', 'password']);
    const u = await comprobarCredenciales(req.body.identificador, req.body.password, req);
    if (u.mfa_activo) {
      const ticket = await firmar({ sub: String(u.id), tipo: 'mfa', recordar: !!req.body.recordar }, 5);
      return enviar(res, 200, { mfa: true, ticket });
    }
    await crearSesion(req, res, u, !!req.body.recordar);
    enviar(res, 200, { ok: true, usuario: publico(u), destino: destinoPorRol(u.rol) });
  },

  // 2) Segundo factor: código TOTP de una app autenticadora
  async 'POST mfa'(req, res) {
    requerir(req.body, ['ticket', 'codigo']);
    let p;
    try { p = await verificar(req.body.ticket); } catch { throw new ErrorHttp(401, 'El tiempo para ingresar el código expiró. Inicia sesión de nuevo.'); }
    if (p.tipo !== 'mfa') throw new ErrorHttp(401, 'Ticket inválido');
    const { rows } = await query('SELECT * FROM usuarios WHERE id = $1', [p.sub]);
    const u = rows[0];
    if (!u || !u.mfa_activo || !u.activo) throw new ErrorHttp(401, 'Ticket inválido');
    if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) throw new ErrorHttp(423, 'Cuenta bloqueada temporalmente');
    if (!totpValido(u.mfa_secreto, req.body.codigo, u.usuario)) {
      const n = u.intentos_fallidos + 1;
      await query(`UPDATE usuarios SET intentos_fallidos = $2,
                   bloqueado_hasta = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE bloqueado_hasta END WHERE id = $1`, [u.id, n >= 5 ? 0 : n]);
      await registrarEvento(u.id, 'MFA_FALLIDO', null, req);
      throw new ErrorHttp(401, 'Código incorrecto');
    }
    await crearSesion(req, res, u, !!p.recordar);
    enviar(res, 200, { ok: true, usuario: publico(u), destino: destinoPorRol(u.rol) });
  },

  // Registro público: sólo crea cuentas con rol "cliente"
  async 'POST registro'(req, res) {
    const b = req.body;
    requerir(b, ['nombre', 'usuario', 'correo', 'password', 'pregunta', 'respuesta']);
    const usuario = String(b.usuario).trim().toLowerCase();
    const correo = String(b.correo).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new ErrorHttp(400, 'El usuario sólo admite letras, números, punto, guion y guion bajo (3 a 40)');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new ErrorHttp(400, 'Correo no válido');
    validarPassword(b.password);
    const existe = await query('SELECT 1 FROM usuarios WHERE usuario = $1 OR correo = $2', [usuario, correo]);
    if (existe.rowCount) throw new ErrorHttp(409, 'El usuario o correo ya está registrado');
    const { rows } = await query(
      `INSERT INTO usuarios (usuario, correo, nombre, telefono, password_hash, rol, pregunta, respuesta_hash)
       VALUES ($1,$2,$3,$4,$5,'cliente',$6,$7) RETURNING id`,
      [usuario, correo, String(b.nombre).trim().slice(0, 120), b.telefono || null,
        await bcrypt.hash(b.password, 10), String(b.pregunta).slice(0, 200), await bcrypt.hash(normalizarRespuesta(b.respuesta), 10)]);
    await registrarEvento(rows[0].id, 'REGISTRO', null, req);
    enviar(res, 201, { ok: true });
  },

  async 'POST logout'(req, res) {
    try {
      const u = await autenticar(req);
      await revocarSesion(u.sid, 'cierre_usuario');
      await registrarEvento(u.id, 'LOGOUT', null, req);
    } catch { /* si ya no había sesión, sólo se limpian las cookies */ }
    limpiarCookies(res);
    enviar(res, 200, { ok: true });
  },

  // Recuperación de sesión: el middleware redirige aquí cuando el token de acceso venció.
  async 'GET renovar'(req, res) {
    const r = await renovarSesion(req, res);
    let siguiente = String(req.query?.next || '/');
    if (!siguiente.startsWith('/') || siguiente.startsWith('//')) siguiente = '/';
    res.statusCode = 302;
    res.setHeader('Location', r.ok ? siguiente : `/login.html?motivo=${r.motivo}&next=${encodeURIComponent(siguiente)}`);
    res.end();
  },
  async 'POST renovar'(req, res) {
    const r = await renovarSesion(req, res);
    if (!r.ok) throw new ErrorHttp(401, 'No se pudo recuperar la sesión', r.motivo);
    enviar(res, 200, { ok: true, usuario: r.usuario });
  },

  async 'GET yo'(req, res) {
    const u = await autenticar(req);
    enviar(res, 200, { usuario: publico(u), sesion: u.sid });
  },

  // Recuperación por correo: enlace de un solo uso con vigencia de 30 minutos.
  async 'POST olvide'(req, res) {
    requerir(req.body, ['correo']);
    const u = await buscarPorIdentificador(req.body.correo);
    if (u && u.activo) {
      const token = aleatorio();
      await query(`INSERT INTO tokens_recuperacion (usuario_id, token_hash, expira_en) VALUES ($1,$2, now() + interval '30 minutes')`, [u.id, sha256(token)]);
      const base = process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
      const enlace = `${base}/restablecer.html?token=${token}`;
      await enviarCorreo({
        para: u.correo,
        asunto: 'Restablece tu contraseña — Huellas del Bravo',
        texto: `Hola ${u.nombre}. Para restablecer tu contraseña abre este enlace (vence en 30 minutos): ${enlace}`,
        html: `<p>Hola <b>${esc(u.nombre)}</b>,</p><p>Recibimos una solicitud para restablecer tu contraseña.</p>
               <p><a href="${enlace}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Restablecer contraseña</a></p>
               <p>El enlace vence en 30 minutos y sólo puede usarse una vez. Si no fuiste tú, ignora este mensaje.</p>`,
      });
      await registrarEvento(u.id, 'RECUPERACION_SOLICITADA', 'correo', req);
    }
    // Respuesta idéntica exista o no la cuenta (evita enumeración de usuarios).
    enviar(res, 200, { ok: true, mensaje: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' });
  },

  async 'POST restablecer'(req, res) {
    requerir(req.body, ['token', 'password']);
    validarPassword(req.body.password);
    const { rows } = await query(`SELECT * FROM tokens_recuperacion WHERE token_hash = $1`, [sha256(req.body.token)]);
    const t = rows[0];
    if (!t || t.usado_en || new Date(t.expira_en) < new Date()) throw new ErrorHttp(400, 'El enlace no es válido o ya expiró');
    await cambiarPassword(t.usuario_id, req.body.password);
    await query('UPDATE tokens_recuperacion SET usado_en = now() WHERE id = $1', [t.id]);
    await registrarEvento(t.usuario_id, 'PASSWORD_RESTABLECIDA', 'correo', req);
    enviar(res, 200, { ok: true });
  },

  // Recuperación por pregunta secreta (paso 1: obtener la pregunta)
  async 'POST pregunta'(req, res) {
    requerir(req.body, ['identificador']);
    const u = await buscarPorIdentificador(req.body.identificador);
    if (u && u.pregunta) return enviar(res, 200, { pregunta: u.pregunta });
    // Pregunta señuelo determinista para no revelar si la cuenta existe.
    const i = parseInt(sha256(String(req.body.identificador).toLowerCase()).slice(0, 2), 16) % PREGUNTAS_SEÑUELO.length;
    enviar(res, 200, { pregunta: PREGUNTAS_SEÑUELO[i] });
  },

  // Paso 2: responder y definir nueva contraseña (máximo 3 intentos)
  async 'POST responder'(req, res) {
    requerir(req.body, ['identificador', 'respuesta', 'password']);
    validarPassword(req.body.password);
    const u = await buscarPorIdentificador(req.body.identificador);
    if (!u || !u.respuesta_hash || !u.activo) throw new ErrorHttp(400, 'Respuesta incorrecta');
    if (u.intentos_pregunta >= 3) throw new ErrorHttp(423, 'Superaste los intentos permitidos. Usa la recuperación por correo.');
    const ok = await bcrypt.compare(normalizarRespuesta(req.body.respuesta), u.respuesta_hash);
    if (!ok) {
      await query('UPDATE usuarios SET intentos_pregunta = intentos_pregunta + 1 WHERE id = $1', [u.id]);
      await registrarEvento(u.id, 'PREGUNTA_FALLIDA', null, req);
      throw new ErrorHttp(400, `Respuesta incorrecta. Intentos restantes: ${2 - u.intentos_pregunta}`);
    }
    await cambiarPassword(u.id, req.body.password);
    await registrarEvento(u.id, 'PASSWORD_RESTABLECIDA', 'pregunta secreta', req);
    enviar(res, 200, { ok: true });
  },
});

async function cambiarPassword(usuarioId, password) {
  await query(`UPDATE usuarios SET password_hash = $2, intentos_fallidos = 0, bloqueado_hasta = NULL, intentos_pregunta = 0 WHERE id = $1`,
    [usuarioId, await bcrypt.hash(password, 10)]);
  // Al cambiar la contraseña se cierran todas las sesiones abiertas.
  await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cambio_password' WHERE usuario_id = $1 AND revocada_en IS NULL`, [usuarioId]);
}
