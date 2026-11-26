// /api/cuenta/* — perfil, contraseña, pregunta secreta, MFA y administración de mis sesiones.
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { enrutador, enviar, requerir, ErrorHttp } from '../../lib/http.js';
import { autenticar, validarPassword, normalizarRespuesta, registrarEvento, publico } from '../../lib/auth.js';
import { nuevoSecreto, totpValido } from '../../lib/mfa.js';

async function confirmarPassword(u, password) {
  if (!(await bcrypt.compare(password || '', u.password_hash))) throw new ErrorHttp(400, 'La contraseña actual es incorrecta');
}

export default enrutador({
  async 'GET sesiones'(req, res) {
    const u = await autenticar(req);
    const { rows } = await query(
      `SELECT id, agente, ip, recordar, creada_en, ultimo_uso, expira_en, revocada_en, motivo
       FROM sesiones WHERE usuario_id = $1 ORDER BY creada_en DESC LIMIT 15`, [u.id]);
    enviar(res, 200, {
      actual: u.sid,
      sesiones: rows.map((s) => ({ ...s, activa: !s.revocada_en && new Date(s.expira_en) > new Date() })),
    });
  },

  async 'POST cerrar-sesion'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['id']);
    if (!/^[0-9a-f-]{36}$/.test(req.body.id)) throw new ErrorHttp(400, 'Id inválido');
    const r = await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cerrada_por_usuario'
                           WHERE id = $1 AND usuario_id = $2 AND revocada_en IS NULL`, [req.body.id, u.id]);
    if (!r.rowCount) throw new ErrorHttp(404, 'Sesión no encontrada');
    await registrarEvento(u.id, 'SESION_CERRADA', `Sesión ${req.body.id}`, req);
    enviar(res, 200, { ok: true });
  },

  async 'POST cerrar-otras'(req, res) {
    const u = await autenticar(req);
    const r = await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cerrada_por_usuario'
                           WHERE usuario_id = $1 AND id <> $2 AND revocada_en IS NULL`, [u.id, u.sid]);
    await registrarEvento(u.id, 'SESIONES_CERRADAS', `${r.rowCount} sesión(es)`, req);
    enviar(res, 200, { ok: true, cerradas: r.rowCount });
  },

  async 'POST perfil'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['nombre']);
    await query('UPDATE usuarios SET nombre = $2, telefono = $3 WHERE id = $1',
      [u.id, String(req.body.nombre).trim().slice(0, 120), req.body.telefono || null]);
    enviar(res, 200, { ok: true });
  },

  async 'POST password'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['actual', 'nueva']);
    await confirmarPassword(u, req.body.actual);
    validarPassword(req.body.nueva);
    await query('UPDATE usuarios SET password_hash = $2 WHERE id = $1', [u.id, await bcrypt.hash(req.body.nueva, 10)]);
    // Se conserva la sesión actual y se cierran las demás.
    await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cambio_password'
                 WHERE usuario_id = $1 AND id <> $2 AND revocada_en IS NULL`, [u.id, u.sid]);
    await registrarEvento(u.id, 'PASSWORD_CAMBIADA', null, req);
    enviar(res, 200, { ok: true });
  },

  async 'POST pregunta'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['pregunta', 'respuesta', 'password']);
    await confirmarPassword(u, req.body.password);
    await query('UPDATE usuarios SET pregunta = $2, respuesta_hash = $3, intentos_pregunta = 0 WHERE id = $1',
      [u.id, String(req.body.pregunta).slice(0, 200), await bcrypt.hash(normalizarRespuesta(req.body.respuesta), 10)]);
    await registrarEvento(u.id, 'PREGUNTA_ACTUALIZADA', null, req);
    enviar(res, 200, { ok: true });
  },

  // MFA paso 1: genera secreto y QR (queda pendiente hasta confirmar un código)
  async 'POST mfa-iniciar'(req, res) {
    const u = await autenticar(req);
    if (u.mfa_activo) throw new ErrorHttp(400, 'El segundo factor ya está activo');
    const s = await nuevoSecreto(u.usuario);
    await query('UPDATE usuarios SET mfa_pendiente = $2 WHERE id = $1', [u.id, s.cifrado]);
    enviar(res, 200, { qr: s.qr, secreto: s.secreto });
  },

  // MFA paso 2: confirma con el primer código de la app
  async 'POST mfa-activar'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['codigo']);
    if (!totpValido(u.mfa_pendiente, req.body.codigo, u.usuario)) throw new ErrorHttp(400, 'Código incorrecto. Revisa la hora de tu teléfono.');
    await query('UPDATE usuarios SET mfa_activo = TRUE, mfa_secreto = mfa_pendiente, mfa_pendiente = NULL WHERE id = $1', [u.id]);
    await registrarEvento(u.id, 'MFA_ACTIVADO', null, req);
    enviar(res, 200, { ok: true });
  },

  async 'POST mfa-desactivar'(req, res) {
    const u = await autenticar(req);
    requerir(req.body, ['password', 'codigo']);
    await confirmarPassword(u, req.body.password);
    if (!totpValido(u.mfa_secreto, req.body.codigo, u.usuario)) throw new ErrorHttp(400, 'Código incorrecto');
    await query('UPDATE usuarios SET mfa_activo = FALSE, mfa_secreto = NULL WHERE id = $1', [u.id]);
    await registrarEvento(u.id, 'MFA_DESACTIVADO', null, req);
    enviar(res, 200, { ok: true });
  },

  async 'GET perfil'(req, res) {
    const u = await autenticar(req);
    enviar(res, 200, { usuario: publico(u), pregunta: u.pregunta });
  },
});

