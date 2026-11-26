// Funciones compartidas del frontend: llamadas a la API, recuperación de sesión y barra de navegación.
export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

export const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const fecha = (f) => f ? new Date(f).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const canal = 'BroadcastChannel' in window ? new BroadcastChannel('hb-sesion') : null;

export class ErrorApi extends Error {
  constructor(status, datos) { super(datos?.error || 'Error'); this.status = status; this.codigo = datos?.codigo; }
}

let renovando = null;
async function renovar() {
  // Una sola renovación a la vez aunque varias peticiones fallen juntas.
  renovando ??= fetch('/api/auth/renovar', { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok).finally(() => setTimeout(() => { renovando = null; }, 0));
  return renovando;
}

export async function api(ruta, { method = 'GET', body, reintento = true, redirigir = true } = {}) {
  const r = await fetch(ruta, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && reintento && ['TOKEN_EXPIRADO', 'TOKEN_AUSENTE'].includes(datos.codigo)) {
    // Recuperación de sesión transparente: se renueva el token y se repite la petición.
    if (await renovar()) return api(ruta, { method, body, reintento: false, redirigir });
    if (redirigir) { irALogin('expirada'); return new Promise(() => {}); }
  }
  if (redirigir && r.status === 401 && ['SESION_REEMPLAZADA', 'SESION_CERRADA'].includes(datos.codigo)) {
    irALogin(datos.codigo === 'SESION_REEMPLAZADA' ? 'reemplazada' : 'cerrada');
    return new Promise(() => {}); // la página se está redirigiendo
  }
  if (!r.ok) throw new ErrorApi(r.status, datos);
  return datos;
}

export function irALogin(motivo) {
  const next = encodeURIComponent(location.pathname + location.search);
  location.href = `/login.html?motivo=${motivo}&next=${next}`;
}

export function toast(msg, ms = 3500) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.textContent = msg; t.classList.remove('oculto');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.add('oculto'), ms);
}

export function aviso(el, msg, tipo = 'error') {
  el.className = `aviso ${tipo}`; el.textContent = msg; el.classList.remove('oculto');
}

export async function conBoton(boton, fn) {
  boton.disabled = true;
  try { return await fn(); } finally { boton.disabled = false; }
}

const MENUS = {
  admin: [['/admin/', 'Panel'], ['/veterinario/', 'Agenda'], ['/cuenta/', 'Mi cuenta']],
  veterinario: [['/veterinario/', 'Agenda'], ['/cuenta/', 'Mi cuenta']],
  cliente: [['/cliente/', 'Mis mascotas'], ['/cuenta/', 'Mi cuenta']],
};
const NOMBRE_ROL = { admin: 'Administrador', veterinario: 'Veterinario', cliente: 'Cliente' };

// Carga el usuario actual, dibuja el menú según su rol y vigila la sesión.
export async function iniciarPagina() {
  const { usuario } = await api('/api/auth/yo');
  const nav = $('#nav');
  nav.innerHTML = MENUS[usuario.rol].map(([href, txt]) =>
    `<a href="${href}" class="${location.pathname.startsWith(href) ? 'activo' : ''}">${txt}</a>`).join('') +
    `<span class="chip-rol">${NOMBRE_ROL[usuario.rol]}</span>
     <button class="btn mini sec" id="salir">Cerrar sesión</button>`;
  $('#salir').addEventListener('click', cerrarSesion);
  canal?.addEventListener('message', (e) => { if (e.data === 'logout') location.href = '/login.html?motivo=cierre'; });
  // Cada minuto se verifica que la sesión siga vigente (p. ej. si se inició en otro equipo).
  setInterval(() => api('/api/auth/yo').catch(() => {}), 60_000);
  return usuario;
}

export async function cerrarSesion() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  canal?.postMessage('logout');
  location.href = '/login.html?motivo=cierre';
}

export const etiquetaEstado = (e) => `<span class="etiqueta ${{ pendiente: 'ambar', atendida: 'verde', cancelada: 'rojo' }[e]}">${e}</span>`;

export function dispositivo(ua = '') {
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'Otro';
  return `${nav} en ${so}`;
}

// Mostrar/ocultar contraseña y medidor de fuerza (formularios de acceso).
function nivelFuerza(p) {
  let n = 0;
  if (p.length >= 8) n++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) n++;
  if (/\d/.test(p)) n++;
  if (/[^A-Za-z0-9]/.test(p)) n++;
  return n;
}
document.addEventListener('DOMContentLoaded', () => {
  $$('[data-ver]').forEach((b) => b.addEventListener('click', () => {
    const input = document.getElementById(b.dataset.ver);
    const ver = input.type === 'password';
    input.type = ver ? 'text' : 'password';
    b.textContent = ver ? 'Ocultar' : 'Mostrar';
  }));
  $$('[data-fuerza-de]').forEach((barra) => {
    const input = document.getElementById(barra.dataset.fuerzaDe);
    input.addEventListener('input', () => {
      const n = nivelFuerza(input.value);
      barra.style.width = `${n * 25}%`;
      barra.style.background = ['#b91c1c', '#b91c1c', '#b45309', '#ca8a04', '#15803d'][n];
    });
  });
});
