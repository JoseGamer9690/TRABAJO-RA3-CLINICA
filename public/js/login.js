import { $, api, aviso, conBoton } from './api.js';

const MOTIVOS = {
  reemplazada: ['Tu sesión se cerró porque se inició sesión con tu cuenta en otro dispositivo (política de sesión única).', 'alerta'],
  expirada: ['Tu sesión expiró. Vuelve a iniciar sesión.', 'info'],
  cierre: ['Cerraste sesión correctamente.', 'ok'],
  cerrada: ['Tu sesión fue cerrada.', 'info'],
  cerrada_por_usuario: ['Esta sesión se cerró desde otro dispositivo.', 'info'],
  cerrada_por_admin: ['El administrador cerró tu sesión.', 'alerta'],
  cambio_password: ['Tu contraseña cambió; inicia sesión con la nueva.', 'info'],
  cambio_rol: ['Tus permisos cambiaron; inicia sesión de nuevo.', 'info'],
  reuso_token: ['Detectamos un uso sospechoso de tu sesión y la cerramos por seguridad.', 'error'],
  cuenta_desactivada: ['Tu cuenta fue desactivada.', 'error'],
  restablecida: ['Contraseña actualizada. Ya puedes iniciar sesión.', 'ok'],
  registrado: ['Cuenta creada. Inicia sesión para continuar.', 'ok'],
};

const params = new URLSearchParams(location.search);
const siguiente = (() => { const n = params.get('next') || ''; return n.startsWith('/') && !n.startsWith('//') ? n : null; })();
let ticket = null;

function entrar(destino) { location.href = siguiente || destino; }

document.addEventListener('DOMContentLoaded', async () => {
  const msg = $('#msg');
  const m = MOTIVOS[params.get('motivo')];
  if (m) aviso(msg, m[0], m[1]);

  // Recuperación de sesión: si hay una sesión recordada válida, se entra directo.
  if (!params.get('motivo')) {
    try {
      const { usuario } = await api('/api/auth/yo', { redirigir: false });
      const destino = { admin: '/admin/', veterinario: '/veterinario/', cliente: '/cliente/' }[usuario.rol];
      aviso(msg, `Sesión recuperada. Entrando como ${usuario.nombre}…`, 'ok');
      return setTimeout(() => entrar(destino), 600);
    } catch { /* sin sesión: se muestra el formulario */ }
  }

  $('#form-login').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        const r = await api('/api/auth/login', { method: 'POST', reintento: false, body: {
          identificador: $('#identificador').value, password: $('#password').value, recordar: $('#recordar').checked,
        } });
        if (r.mfa) {
          ticket = r.ticket;
          $('#form-login').classList.add('oculto'); $('#form-mfa').classList.remove('oculto');
          msg.classList.add('oculto'); $('#codigo').focus();
          return;
        }
        entrar(r.destino);
      } catch (err) { aviso(msg, err.message); }
    });
  });

  $('#form-mfa').addEventListener('submit', (e) => {
    e.preventDefault();
    conBoton(e.submitter, async () => {
      try {
        const r = await api('/api/auth/mfa', { method: 'POST', reintento: false, body: { ticket, codigo: $('#codigo').value } });
        entrar(r.destino);
      } catch (err) { aviso(msg, err.message); }
    });
  });
});
