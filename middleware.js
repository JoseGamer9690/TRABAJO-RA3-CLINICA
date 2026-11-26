// Routing Middleware de Vercel: protege las páginas según el rol antes de servirlas.
import { next } from '@vercel/functions';
import { jwtVerify } from 'jose';

export const config = {
  matcher: ['/admin/:path*', '/veterinario/:path*', '/cliente/:path*', '/cuenta/:path*'],
};

// Tabla de permisos: sección → roles que pueden entrar.
const PERMISOS = {
  '/admin': ['admin'],
  '/veterinario': ['veterinario', 'admin'],
  '/cliente': ['cliente'],
  '/cuenta': ['admin', 'veterinario', 'cliente'],
};

function leerCookie(request, nombre) {
  const raw = request.headers.get('cookie') || '';
  const par = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(nombre + '='));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const seccion = '/' + url.pathname.split('/')[1];
  const roles = PERMISOS[seccion];
  if (!roles) return next();

  const destino = url.pathname + url.search;
  const acceso = leerCookie(request, 'hb_access');

  if (acceso) {
    try {
      const { payload } = await jwtVerify(acceso, new TextEncoder().encode(process.env.JWT_SECRET), { algorithms: ['HS256'] });
      if (roles.includes(payload.rol)) return next({ headers: { 'Cache-Control': 'no-store' } });
      // Autenticado pero sin el rol requerido
      return Response.redirect(new URL('/403.html', request.url), 302);
    } catch {
      // token vencido o alterado: se intenta recuperar la sesión abajo
    }
  }

  // Recuperación de sesión: si existe la cookie de sesión, se renueva el token de acceso.
  if (leerCookie(request, 'hb_refresh')) {
    return Response.redirect(new URL(`/api/auth/renovar?next=${encodeURIComponent(destino)}`, request.url), 302);
  }
  return Response.redirect(new URL(`/login.html?next=${encodeURIComponent(destino)}`, request.url), 302);
}
