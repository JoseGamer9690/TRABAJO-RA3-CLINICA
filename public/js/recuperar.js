import { $, api, aviso, conBoton } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  const msg = $('#msg');
  const mostrar = (metodo) => {
    $('#form-correo').classList.toggle('oculto', metodo !== 'correo');
    $('#form-pregunta').classList.toggle('oculto', metodo !== 'pregunta');
    $('#tab-correo').className = metodo === 'correo' ? 'btn' : 'btn sec';
    $('#tab-pregunta').className = metodo === 'pregunta' ? 'btn' : 'btn sec';
    msg.classList.add('oculto');
  };
  $('#tab-correo').addEventListener('click', () => mostrar('correo'));
  $('#tab-pregunta').addEventListener('click', () => mostrar('pregunta'));

  $('#form-correo').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        const r = await api('/api/auth/olvide', { method: 'POST', body: { correo: $('#correo').value } });
        aviso(msg, r.mensaje, 'ok');
      } catch (err) { aviso(msg, err.message); }
    });
  });

  $('#ver-pregunta').addEventListener('click', (e) => conBoton(e.currentTarget, async () => {
    try {
      const r = await api('/api/auth/pregunta', { method: 'POST', body: { identificador: $('#ident').value } });
      $('#texto-pregunta').textContent = r.pregunta;
      $('#bloque-respuesta').classList.remove('oculto');
      $('#respuesta').focus();
    } catch (err) { aviso(msg, err.message); }
  }));

  $('#form-pregunta').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        await api('/api/auth/responder', { method: 'POST', body: {
          identificador: $('#ident').value, respuesta: $('#respuesta').value, password: $('#nueva').value,
        } });
        location.href = '/login.html?motivo=restablecida';
      } catch (err) { aviso(msg, err.message); }
    });
  });
});
