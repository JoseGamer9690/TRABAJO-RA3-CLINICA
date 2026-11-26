import { $, api, esc, fecha, toast, conBoton, iniciarPagina, etiquetaEstado } from './api.js';

async function cargar() {
  const [{ mascotas }, { citas }, { veterinarios }] = await Promise.all([
    api('/api/clinica/mascotas'), api('/api/clinica/mis-citas'), api('/api/clinica/veterinarios'),
  ]);
  $('#mascotas').innerHTML = mascotas.length ? `<table class="tabla"><thead><tr><th>Nombre</th><th>Especie</th><th>Raza</th><th>Edad</th></tr></thead><tbody>
    ${mascotas.map((m) => `<tr><td><b>${esc(m.nombre)}</b></td><td>${esc(m.especie)}</td><td>${esc(m.raza || '—')}</td><td>${m.edad ?? '—'}</td></tr>`).join('')}
    </tbody></table>` : '<p class="ayuda">Aún no registras mascotas.</p>';
  $('#c-mascota').innerHTML = mascotas.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join('') || '<option value="">Registra una mascota primero</option>';
  $('#c-vet').innerHTML = veterinarios.map((v) => `<option value="${v.id}">${esc(v.nombre)}</option>`).join('');
  $('#citas').innerHTML = citas.length ? `<table class="tabla"><thead><tr><th>Fecha</th><th>Mascota</th><th>Veterinario</th><th>Motivo</th><th>Estado</th><th></th></tr></thead><tbody>
    ${citas.map((c) => `<tr><td>${fecha(c.fecha)}</td><td>${esc(c.mascota)}</td><td>${esc(c.veterinario || '—')}</td>
      <td>${esc(c.motivo)}${c.notas ? `<div class="ayuda">Notas: ${esc(c.notas)}</div>` : ''}</td><td>${etiquetaEstado(c.estado)}</td>
      <td>${c.estado === 'pendiente' ? `<button class="btn mini sec" data-cancelar="${c.id}">Cancelar</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<p class="ayuda">No tienes citas.</p>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const u = await iniciarPagina();
  $('#saludo').textContent = `Hola, ${u.nombre.split(' ')[0]}`;
  await cargar();

  $('#form-mascota').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        await api('/api/clinica/mascota', { method: 'POST', body: {
          nombre: $('#m-nombre').value, especie: $('#m-especie').value, raza: $('#m-raza').value, edad: $('#m-edad').value,
        } });
        e.target.reset(); toast('Mascota registrada'); await cargar();
      } catch (err) { toast(err.message); }
    });
  });

  $('#form-cita').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        const local = $('#c-fecha').value;
        await api('/api/clinica/cita', { method: 'POST', body: {
          mascota_id: $('#c-mascota').value, veterinario_id: $('#c-vet').value,
          fecha: local ? new Date(local).toISOString() : '', motivo: $('#c-motivo').value,
        } });
        e.target.reset(); toast('Cita agendada'); await cargar();
      } catch (err) { toast(err.message); }
    });
  });

  $('#citas').addEventListener('click', async (e) => {
    const id = e.target.dataset.cancelar;
    if (!id) return;
    try { await api('/api/clinica/cancelar', { method: 'POST', body: { id } }); toast('Cita cancelada'); await cargar(); }
    catch (err) { toast(err.message); }
  });
});
