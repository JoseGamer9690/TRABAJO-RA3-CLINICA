import { $, api, aviso, conBoton } from './api.js';

document.addEventListener('DOMContentLoaded', () => {
  const token = new URLSearchParams(location.search).get('token');
  const msg = $('#msg');
  if (!token) aviso(msg, 'El enlace no es válido. Solicita uno nuevo.');
  // Se quita el token de la barra de direcciones para que no quede en el historial.
  history.replaceState(null, '', '/restablecer.html');

  $('#form').addEventListener('submit', (e) => {
    e.preventDefault();
    if ($('#password').value !== $('#password2').value) return aviso(msg, 'Las contraseñas no coinciden');
    conBoton(e.submitter, async () => {
      try {
        await api('/api/auth/restablecer', { method: 'POST', body: { token, password: $('#password').value } });
        location.href = '/login.html?motivo=restablecida';
      } catch (err) { aviso(msg, err.message); }
    });
  });
});
