import { $, api, esc, fecha, toast, conBoton, iniciarPagina, etiquetaEstado } from './api.js';

let citas = [];
let seleccionada = null;

async function cargar() {
  ({ citas } = await api('/api/clinica/agenda'));
  const n = (e) => citas.filter((c) => c.estado === e).length;
  const hoy = citas.filter((c) => new Date(c.fecha).toDateString() === new Date().toDateString()).length;
  $('#kpis').innerHTML = [['Pendientes', n('pendiente')], ['Para hoy', hoy], ['Atendidas', n('atendida')], ['Canceladas', n('cancelada')]]
    .map(([t, v]) => `<div class="tarjeta kpi"><div class="num">${v}</div><div class="txt">${t}</div></div>`).join('');
  $('#agenda').innerHTML = citas.length ? `<table class="tabla"><thead><tr><th>Fecha</th><th>Paciente</th><th>Propietario</th><th>Motivo</th><th>Veterinario</th><th>Estado</th><th></th></tr></thead><tbody>
    ${citas.map((c) => `<tr><td>${fecha(c.fecha)}</td><td><b>${esc(c.mascota)}</b><div class="ayuda">${esc(c.especie)} ${esc(c.raza || '')}</div></td>
      <td>${esc(c.cliente)}<div class="ayuda">${esc(c.telefono || '')}</div></td><td>${esc(c.motivo)}${c.notas ? `<div class="ayuda">Notas: ${esc(c.notas)}</div>` : ''}</td>
      <td>${esc(c.veterinario || '—')}</td><td>${etiquetaEstado(c.estado)}</td>
      <td>${c.estado === 'pendiente' ? `<button class="btn mini" data-atender="${c.id}">Atender</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<p class="ayuda">No hay citas asignadas.</p>';
}

document.addEventListener('DOMContentLoaded', async () => {
  const u = await iniciarPagina();
  $('#saludo').textContent = u.rol === 'admin' ? 'Agenda general (supervisión)' : `Agenda de ${u.nombre}`;
  await cargar();

  $('#agenda').addEventListener('click', (e) => {
    const id = Number(e.target.dataset.atender);
    if (!id) return;
    seleccionada = citas.find((c) => c.id === id);
    $('#atender-info').textContent = `${seleccionada.mascota} — ${seleccionada.motivo} (${fecha(seleccionada.fecha)})`;
    $('#form-atender').classList.remove('oculto');
    $('#notas').focus();
  });
  $('#cancelar-atender').addEventListener('click', () => $('#form-atender').classList.add('oculto'));
  $('#form-atender').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        await api('/api/clinica/atender', { method: 'POST', body: { id: seleccionada.id, notas: $('#notas').value } });
        e.target.reset(); e.target.classList.add('oculto'); toast('Consulta registrada'); await cargar();
      } catch (err) { toast(err.message); }
    });
  });
});
