import { $, $$, api, esc, fecha, toast, conBoton, iniciarPagina, dispositivo } from './api.js';

const ROLES = { admin: 'Administrador', veterinario: 'Veterinario', cliente: 'Cliente' };
let yo;

async function kpis() {
  const r = await api('/api/admin/resumen');
  $('#kpis').innerHTML = [['Usuarios', r.usuarios], ['Sesiones activas', r.sesiones_activas], ['Citas pendientes', r.citas_pendientes], ['Alertas (24 h)', r.alertas_24h]]
    .map(([t, v]) => `<div class="tarjeta kpi"><div class="num">${v}</div><div class="txt">${t}</div></div>`).join('');
}

async function usuarios() {
  const { usuarios } = await api('/api/admin/usuarios');
  $('#usuarios').innerHTML = `<table class="tabla"><thead><tr><th>Nombre</th><th>Usuario / correo</th><th>Rol</th><th>MFA</th><th>Sesiones</th><th>Estado</th><th></th></tr></thead><tbody>
  ${usuarios.map((u) => {
    const bloqueado = u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date();
    const propio = u.id === yo.id;
    return `<tr><td><b>${esc(u.nombre)}</b></td><td>${esc(u.usuario)}<div class="ayuda">${esc(u.correo)}</div></td>
      <td><select data-rol="${u.id}" ${propio ? 'disabled' : ''}>${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.rol ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td>${u.mfa_activo ? '<span class="etiqueta verde">Sí</span>' : '<span class="etiqueta">No</span>'}</td>
      <td>${u.sesiones}</td>
      <td>${!u.activo ? '<span class="etiqueta rojo">Inactivo</span>' : bloqueado ? '<span class="etiqueta ambar">Bloqueado</span>' : '<span class="etiqueta verde">Activo</span>'}</td>
      <td>${propio ? '' : `<button class="btn mini ${u.activo ? 'peligro' : ''}" data-estado="${u.id}" data-activo="${u.activo ? 0 : 1}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`;
  }).join('')}</tbody></table>`;
}

async function sesiones() {
  const { sesiones } = await api('/api/admin/sesiones');
  $('#sesiones').innerHTML = `<table class="tabla"><thead><tr><th>Usuario</th><th>Rol</th><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Último uso</th><th>Expira</th><th></th></tr></thead><tbody>
  ${sesiones.map((s) => `<tr><td>${esc(s.nombre)}<div class="ayuda">${esc(s.usuario)}</div></td><td>${ROLES[s.rol]}</td>
    <td>${esc(dispositivo(s.agente))}${s.recordar ? ' <span class="etiqueta azul">Recordada</span>' : ''}</td><td>${esc(s.ip)}</td>
    <td>${fecha(s.creada_en)}</td><td>${fecha(s.ultimo_uso)}</td><td>${fecha(s.expira_en)}</td>
    <td><button class="btn mini peligro" data-cerrar="${s.id}">Cerrar</button></td></tr>`).join('')}</tbody></table>`;
}

const TIPO_ALERTA = ['LOGIN_FALLIDO', 'CUENTA_BLOQUEADA', 'ACCESO_DENEGADO', 'ALERTA_REUSO_TOKEN', 'MFA_FALLIDO', 'PREGUNTA_FALLIDA'];
async function eventos() {
  const { eventos } = await api('/api/admin/eventos');
  $('#eventos').innerHTML = `<table class="tabla"><thead><tr><th>Fecha</th><th>Usuario</th><th>Evento</th><th>Detalle</th><th>IP</th></tr></thead><tbody>
  ${eventos.map((e) => `<tr><td>${fecha(e.fecha)}</td><td>${esc(e.usuario || '—')}</td>
    <td><span class="etiqueta ${TIPO_ALERTA.includes(e.tipo) ? 'rojo' : 'azul'}">${esc(e.tipo)}</span></td><td>${esc(e.detalle || '')}</td><td>${esc(e.ip || '')}</td></tr>`).join('')}</tbody></table>`;
}

const recargar = () => Promise.all([kpis(), usuarios(), sesiones(), eventos()]);

document.addEventListener('DOMContentLoaded', async () => {
  yo = await iniciarPagina();
  await recargar();

  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('activo', x === b));
    ['usuarios', 'sesiones', 'eventos'].forEach((t) => $(`#tab-${t}`).classList.toggle('oculto', t !== b.dataset.tab));
    recargar();
  }));

  $('#usuarios').addEventListener('change', async (e) => {
    if (!e.target.dataset.rol) return;
    try { await api('/api/admin/rol', { method: 'POST', body: { id: e.target.dataset.rol, rol: e.target.value } }); toast('Rol actualizado; se cerraron sus sesiones'); await recargar(); }
    catch (err) { toast(err.message); }
  });
  $('#usuarios').addEventListener('click', async (e) => {
    const id = e.target.dataset.estado;
    if (!id) return;
    try { await api('/api/admin/estado', { method: 'POST', body: { id, activo: e.target.dataset.activo === '1' } }); toast('Estado actualizado'); await recargar(); }
    catch (err) { toast(err.message); }
  });
  $('#sesiones').addEventListener('click', async (e) => {
    const id = e.target.dataset.cerrar;
    if (!id) return;
    try { await api('/api/admin/cerrar-sesion', { method: 'POST', body: { id } }); toast('Sesión cerrada'); await recargar(); }
    catch (err) { toast(err.message); }
  });
  $('#form-usuario').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        await api('/api/admin/crear-usuario', { method: 'POST', body: {
          nombre: $('#u-nombre').value, usuario: $('#u-usuario').value, correo: $('#u-correo').value,
          rol: $('#u-rol').value, password: $('#u-password').value,
        } });
        e.target.reset(); toast('Usuario creado'); await recargar();
      } catch (err) { toast(err.message); }
    });
  });
});
