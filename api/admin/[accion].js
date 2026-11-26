// /api/admin/* — exclusivo del rol "admin": usuarios, roles, sesiones activas y bitácora.
import bcrypt from 'bcryptjs';
import { query } from '../../lib/db.js';
import { enrutador, enviar, requerir, ErrorHttp } from '../../lib/http.js';
import { autenticar, validarPassword, registrarEvento } from '../../lib/auth.js';

const ROLES = ['admin', 'veterinario', 'cliente'];
const soloAdmin = (req) => autenticar(req, ['admin']);

export default enrutador({
  async 'GET resumen'(req, res) {
    await soloAdmin(req);
    const { rows } = await query(`SELECT
      (SELECT COUNT(*) FROM usuarios)::int AS usuarios,
      (SELECT COUNT(*) FROM sesiones WHERE revocada_en IS NULL AND expira_en > now())::int AS sesiones_activas,
      (SELECT COUNT(*) FROM citas WHERE estado = 'pendiente')::int AS citas_pendientes,
      (SELECT COUNT(*) FROM eventos WHERE tipo IN ('LOGIN_FALLIDO','CUENTA_BLOQUEADA','ACCESO_DENEGADO','ALERTA_REUSO_TOKEN')
         AND fecha > now() - interval '24 hours')::int AS alertas_24h`);
    enviar(res, 200, rows[0]);
  },

  async 'GET usuarios'(req, res) {
    await soloAdmin(req);
    const { rows } = await query(`SELECT id, usuario, correo, nombre, rol, activo, mfa_activo, bloqueado_hasta, creado_en,
      (SELECT COUNT(*) FROM sesiones s WHERE s.usuario_id = u.id AND s.revocada_en IS NULL AND s.expira_en > now())::int AS sesiones
      FROM usuarios u ORDER BY rol, nombre`);
    enviar(res, 200, { usuarios: rows });
  },

  async 'POST crear-usuario'(req, res) {
    const a = await soloAdmin(req);
    const b = req.body;
    requerir(b, ['nombre', 'usuario', 'correo', 'password', 'rol']);
    if (!ROLES.includes(b.rol)) throw new ErrorHttp(400, 'Rol no válido');
    validarPassword(b.password);
    const usuario = String(b.usuario).trim().toLowerCase();
    const correo = String(b.correo).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) throw new ErrorHttp(400, 'Usuario no válido');
    const existe = await query('SELECT 1 FROM usuarios WHERE usuario = $1 OR correo = $2', [usuario, correo]);
    if (existe.rowCount) throw new ErrorHttp(409, 'El usuario o correo ya existe');
    await query(`INSERT INTO usuarios (usuario, correo, nombre, password_hash, rol) VALUES ($1,$2,$3,$4,$5)`,
      [usuario, correo, String(b.nombre).trim(), await bcrypt.hash(b.password, 10), b.rol]);
    await registrarEvento(a.id, 'USUARIO_CREADO', `${usuario} (${b.rol})`, req);
    enviar(res, 201, { ok: true });
  },

  async 'POST rol'(req, res) {
    const a = await soloAdmin(req);
    requerir(req.body, ['id', 'rol']);
    if (!ROLES.includes(req.body.rol)) throw new ErrorHttp(400, 'Rol no válido');
    if (Number(req.body.id) === a.id) throw new ErrorHttp(400, 'No puedes cambiar tu propio rol');
    await query('UPDATE usuarios SET rol = $2 WHERE id = $1', [req.body.id, req.body.rol]);
    // El rol viaja dentro del token: se cierran sus sesiones para que el cambio aplique de inmediato.
    await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cambio_rol' WHERE usuario_id = $1 AND revocada_en IS NULL`, [req.body.id]);
    await registrarEvento(a.id, 'ROL_CAMBIADO', `Usuario ${req.body.id} → ${req.body.rol}`, req);
    enviar(res, 200, { ok: true });
  },

  async 'POST estado'(req, res) {
    const a = await soloAdmin(req);
    requerir(req.body, ['id']);
    if (Number(req.body.id) === a.id) throw new ErrorHttp(400, 'No puedes desactivar tu propia cuenta');
    const activo = !!req.body.activo;
    await query('UPDATE usuarios SET activo = $2, bloqueado_hasta = NULL, intentos_fallidos = 0, intentos_pregunta = 0 WHERE id = $1', [req.body.id, activo]);
    if (!activo) await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cuenta_desactivada' WHERE usuario_id = $1 AND revocada_en IS NULL`, [req.body.id]);
    await registrarEvento(a.id, activo ? 'USUARIO_ACTIVADO' : 'USUARIO_DESACTIVADO', `Usuario ${req.body.id}`, req);
    enviar(res, 200, { ok: true });
  },

  async 'GET sesiones'(req, res) {
    await soloAdmin(req);
    const { rows } = await query(`SELECT s.id, s.agente, s.ip, s.recordar, s.creada_en, s.ultimo_uso, s.expira_en,
      u.usuario, u.nombre, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.revocada_en IS NULL AND s.expira_en > now() ORDER BY s.ultimo_uso DESC`);
    enviar(res, 200, { sesiones: rows });
  },

  async 'POST cerrar-sesion'(req, res) {
    const a = await soloAdmin(req);
    requerir(req.body, ['id']);
    if (!/^[0-9a-f-]{36}$/.test(req.body.id)) throw new ErrorHttp(400, 'Id inválido');
    await query(`UPDATE sesiones SET revocada_en = now(), motivo = 'cerrada_por_admin' WHERE id = $1 AND revocada_en IS NULL`, [req.body.id]);
    await registrarEvento(a.id, 'SESION_CERRADA_ADMIN', `Sesión ${req.body.id}`, req);
    enviar(res, 200, { ok: true });
  },

  async 'GET eventos'(req, res) {
    await soloAdmin(req);
    const { rows } = await query(`SELECT e.id, e.tipo, e.detalle, e.ip, e.fecha, u.usuario
      FROM eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id ORDER BY e.fecha DESC LIMIT 100`);
    enviar(res, 200, { eventos: rows });
  },
});
