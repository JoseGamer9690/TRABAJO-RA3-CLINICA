// /api/clinica/* — funciones del negocio: mascotas y citas, protegidas por rol.
import { query } from '../../lib/db.js';
import { enrutador, enviar, requerir, ErrorHttp } from '../../lib/http.js';
import { autenticar, registrarEvento } from '../../lib/auth.js';

export default enrutador({
  async 'GET veterinarios'(req, res) {
    await autenticar(req);
    const { rows } = await query(`SELECT id, nombre FROM usuarios WHERE rol = 'veterinario' AND activo ORDER BY nombre`);
    enviar(res, 200, { veterinarios: rows });
  },

  // ----- Cliente -----
  async 'GET mascotas'(req, res) {
    const u = await autenticar(req, ['cliente']);
    const { rows } = await query('SELECT * FROM mascotas WHERE dueno_id = $1 ORDER BY nombre', [u.id]);
    enviar(res, 200, { mascotas: rows });
  },

  async 'POST mascota'(req, res) {
    const u = await autenticar(req, ['cliente']);
    requerir(req.body, ['nombre', 'especie']);
    await query('INSERT INTO mascotas (dueno_id, nombre, especie, raza, edad) VALUES ($1,$2,$3,$4,$5)',
      [u.id, String(req.body.nombre).slice(0, 60), String(req.body.especie).slice(0, 30),
        req.body.raza ? String(req.body.raza).slice(0, 60) : null, req.body.edad ? Number(req.body.edad) : null]);
    enviar(res, 201, { ok: true });
  },

  async 'GET mis-citas'(req, res) {
    const u = await autenticar(req, ['cliente']);
    const { rows } = await query(`SELECT c.*, m.nombre AS mascota, v.nombre AS veterinario FROM citas c
      JOIN mascotas m ON m.id = c.mascota_id LEFT JOIN usuarios v ON v.id = c.veterinario_id
      WHERE c.cliente_id = $1 ORDER BY c.fecha DESC`, [u.id]);
    enviar(res, 200, { citas: rows });
  },

  async 'POST cita'(req, res) {
    const u = await autenticar(req, ['cliente']);
    requerir(req.body, ['mascota_id', 'veterinario_id', 'fecha', 'motivo']);
    const m = await query('SELECT 1 FROM mascotas WHERE id = $1 AND dueno_id = $2', [req.body.mascota_id, u.id]);
    if (!m.rowCount) throw new ErrorHttp(403, 'La mascota no te pertenece');
    const v = await query(`SELECT 1 FROM usuarios WHERE id = $1 AND rol = 'veterinario' AND activo`, [req.body.veterinario_id]);
    if (!v.rowCount) throw new ErrorHttp(400, 'Veterinario no válido');
    const fecha = new Date(req.body.fecha);
    if (isNaN(fecha) || fecha < new Date()) throw new ErrorHttp(400, 'La fecha debe ser futura');
    await query(`INSERT INTO citas (mascota_id, cliente_id, veterinario_id, fecha, motivo) VALUES ($1,$2,$3,$4,$5)`,
      [req.body.mascota_id, u.id, req.body.veterinario_id, fecha, String(req.body.motivo).slice(0, 300)]);
    await registrarEvento(u.id, 'CITA_CREADA', null, req);
    enviar(res, 201, { ok: true });
  },

  async 'POST cancelar'(req, res) {
    const u = await autenticar(req, ['cliente']);
    requerir(req.body, ['id']);
    const r = await query(`UPDATE citas SET estado = 'cancelada' WHERE id = $1 AND cliente_id = $2 AND estado = 'pendiente'`, [req.body.id, u.id]);
    if (!r.rowCount) throw new ErrorHttp(404, 'Cita no encontrada');
    enviar(res, 200, { ok: true });
  },

  // ----- Veterinario (y administrador como supervisor) -----
  async 'GET agenda'(req, res) {
    const u = await autenticar(req, ['veterinario', 'admin']);
    const filtro = u.rol === 'veterinario' ? 'WHERE c.veterinario_id = $1' : 'WHERE $1::int IS NOT NULL';
    const { rows } = await query(`SELECT c.*, m.nombre AS mascota, m.especie, m.raza, cl.nombre AS cliente, cl.telefono,
      v.nombre AS veterinario FROM citas c JOIN mascotas m ON m.id = c.mascota_id
      JOIN usuarios cl ON cl.id = c.cliente_id LEFT JOIN usuarios v ON v.id = c.veterinario_id
      ${filtro} ORDER BY (c.estado = 'pendiente') DESC, c.fecha`, [u.id]);
    enviar(res, 200, { citas: rows });
  },

  async 'POST atender'(req, res) {
    const u = await autenticar(req, ['veterinario', 'admin']);
    requerir(req.body, ['id', 'notas']);
    const r = await query(`UPDATE citas SET estado = 'atendida', notas = $3
      WHERE id = $1 AND estado = 'pendiente' AND ($2::text = 'admin' OR veterinario_id = $4)`,
    [req.body.id, u.rol, String(req.body.notas).slice(0, 1000), u.id]);
    if (!r.rowCount) throw new ErrorHttp(404, 'Cita no encontrada o no asignada a ti');
    await registrarEvento(u.id, 'CITA_ATENDIDA', `Cita ${req.body.id}`, req);
    enviar(res, 200, { ok: true });
  },
});
