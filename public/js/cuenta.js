import { $, api, esc, fecha, toast, conBoton, iniciarPagina, dispositivo } from './api.js';

const MOTIVO = { reemplazada: 'Reemplazada (sesión única)', cierre_usuario: 'Cerró sesión', cerrada_por_usuario: 'Cerrada desde otro dispositivo',
  cerrada_por_admin: 'Cerrada por el administrador', cambio_password: 'Cambio de contraseña', cambio_rol: 'Cambio de rol', reuso_token: 'Uso sospechoso' };

async function perfil() {
  const { usuario, pregunta } = await api('/api/cuenta/perfil');
  $('#datos-cuenta').textContent = `Usuario: ${usuario.usuario} · Correo: ${usuario.correo}`;
  $('#p-nombre').value = usuario.nombre;
  $('#p-tel').value = usuario.telefono || '';
  $('#pregunta-actual').textContent = pregunta ? `Pregunta actual: ${pregunta}` : 'Aún no tienes pregunta secreta.';
  $('#mfa-estado').innerHTML = usuario.mfa_activo
    ? '<span class="etiqueta verde">Activa</span> Se te pedirá un código al iniciar sesión.'
    : '<span class="etiqueta">Inactiva</span> Agrega una capa extra de seguridad a tu cuenta.';
  $('#mfa-off').classList.toggle('oculto', usuario.mfa_activo);
  $('#form-mfa-desactivar').classList.toggle('oculto', !usuario.mfa_activo);
  $('#politica').textContent = ['admin', 'veterinario'].includes(usuario.rol)
    ? 'Política de tu rol: sesión única. Al iniciar sesión en otro equipo, las demás sesiones se cierran automáticamente.'
    : 'Política de tu rol: multisesión. Puedes tener la sesión abierta en varios dispositivos y cerrarlas desde aquí.';
}

async function sesiones() {
  const { actual, sesiones } = await api('/api/cuenta/sesiones');
  $('#sesiones').innerHTML = `<table class="tabla"><thead><tr><th>Dispositivo</th><th>IP</th><th>Inicio</th><th>Último uso</th><th>Estado</th><th></th></tr></thead><tbody>
  ${sesiones.map((s) => `<tr><td>${esc(dispositivo(s.agente))}${s.id === actual ? ' <span class="etiqueta azul">Este dispositivo</span>' : ''}${s.recordar ? ' <span class="etiqueta">Recordada</span>' : ''}</td>
    <td>${esc(s.ip)}</td><td>${fecha(s.creada_en)}</td><td>${fecha(s.ultimo_uso)}</td>
    <td>${s.activa ? '<span class="etiqueta verde">Activa</span>' : `<span class="etiqueta">${esc(MOTIVO[s.motivo] || (s.revocada_en ? 'Cerrada' : 'Expirada'))}</span>`}</td>
    <td>${s.activa && s.id !== actual ? `<button class="btn mini peligro" data-cerrar="${s.id}">Cerrar</button>` : ''}</td></tr>`).join('')}</tbody></table>`;
}

const enviarForm = (id, fn) => $(id).addEventListener('submit', (e) => {
  e.preventDefault();
  conBoton(e.submitter, async () => { try { await fn(e.target); } catch (err) { toast(err.message); } });
});

document.addEventListener('DOMContentLoaded', async () => {
  await iniciarPagina();
  await Promise.all([perfil(), sesiones()]);

  enviarForm('#form-perfil', async () => {
    await api('/api/cuenta/perfil', { method: 'POST', body: { nombre: $('#p-nombre').value, telefono: $('#p-tel').value } });
    toast('Perfil actualizado');
  });
  enviarForm('#form-pass', async (f) => {
    await api('/api/cuenta/password', { method: 'POST', body: { actual: $('#pa-actual').value, nueva: $('#pa-nueva').value } });
    f.reset(); toast('Contraseña actualizada; se cerraron tus otras sesiones'); await sesiones();
  });
  enviarForm('#form-pregunta', async (f) => {
    await api('/api/cuenta/pregunta', { method: 'POST', body: { pregunta: $('#pr-pregunta').value, respuesta: $('#pr-resp').value, password: $('#pr-pass').value } });
    f.reset(); toast('Pregunta secreta guardada'); await perfil();
  });

  $('#mfa-iniciar').addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    try {
      const r = await api('/api/cuenta/mfa-iniciar', { method: 'POST' });
      $('#mfa-qr').src = r.qr;
      $('#mfa-secreto').textContent = r.secreto;
      $('#form-mfa-activar').classList.remove('oculto');
      $('#mfa-iniciar').classList.add('oculto');
    } catch (err) { toast(err.message); }
  }));
  enviarForm('#form-mfa-activar', async (f) => {
    await api('/api/cuenta/mfa-activar', { method: 'POST', body: { codigo: $('#mfa-codigo').value } });
    f.reset(); f.classList.add('oculto'); $('#mfa-iniciar').classList.remove('oculto');
    toast('Verificación en dos pasos activada'); await perfil();
  });
  enviarForm('#form-mfa-desactivar', async (f) => {
    await api('/api/cuenta/mfa-desactivar', { method: 'POST', body: { password: $('#d-pass').value, codigo: $('#d-codigo').value } });
    f.reset(); toast('MFA desactivado'); await perfil();
  });

  $('#sesiones').addEventListener('click', async (e) => {
    const id = e.target.dataset.cerrar;
    if (!id) return;
    try { await api('/api/cuenta/cerrar-sesion', { method: 'POST', body: { id } }); toast('Sesión cerrada'); await sesiones(); }
    catch (err) { toast(err.message); }
  });
  $('#cerrar-otras').addEventListener('click', async () => {
    try { const r = await api('/api/cuenta/cerrar-otras', { method: 'POST' }); toast(`Se cerraron ${r.cerradas} sesión(es)`); await sesiones(); }
    catch (err) { toast(err.message); }
  });
});
