import { $, api, aviso, conBoton } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    const msg = $('#msg');
    if ($('#password').value !== $('#password2').value) return aviso(msg, 'Las contraseñas no coinciden');
    conBoton(e.submitter, async () => {
      try {
        await api('/api/auth/registro', { method: 'POST', body: {
          nombre: $('#nombre').value, usuario: $('#usuario').value, telefono: $('#telefono').value,
          correo: $('#correo').value, password: $('#password').value,
          pregunta: $('#pregunta').value, respuesta: $('#respuesta').value,
        } });
        location.href = '/login.html?motivo=registrado';
      } catch (err) { aviso(msg, err.message); }
    });
  });
});
