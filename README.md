# Huellas del Bravo — Clínica Veterinaria

Sitio web con autenticación por tipo de usuario, manejo de multisesiones, recuperación de contraseñas y protección de rutas por rol.

- **Frontend:** HTML5, CSS3 y JavaScript (módulos ES) en `public/`
- **Backend:** funciones serverless de Node.js en `api/` + Routing Middleware (`middleware.js`)
- **Base de datos:** PostgreSQL (Neon, desde Vercel Marketplace)
- **Alojamiento:** Vercel

## Usuarios de demostración

Se crean solos la primera vez que se usa la API (contraseña `SEED_PASSWORD`, por defecto `Huellas#2026`; respuesta secreta: `bravo`).

| Usuario | Correo | Rol |
|---|---|---|
| admin | admin@huellasdelbravo.mx | Administrador |
| dra.sofia | sofia@huellasdelbravo.mx | Veterinario |
| dr.luis | luis@huellasdelbravo.mx | Veterinario |
| cliente | cliente@huellasdelbravo.mx | Cliente |

## Despliegue en Vercel

1. Sube esta carpeta a un repositorio de GitHub (sin `node_modules`).
2. En vercel.com → **Add New → Project** → importa el repositorio. Framework Preset: **Other**. No cambies Build ni Output (lo define `vercel.json`).
3. Antes o después del primer deploy: en el proyecto → **Storage → Create Database → Neon (Postgres)** → *Connect*. Esto agrega `DATABASE_URL` automáticamente.
4. **Settings → Environment Variables**, agrega:
   - `JWT_SECRET` → una cadena aleatoria larga (por ejemplo, la salida de `openssl rand -base64 48`).
   - (Opcional) `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` para enviar el correo de recuperación. Con Gmail: activa la verificación en 2 pasos y crea una *contraseña de aplicación*.
5. **Deployments → Redeploy** para que tome las variables.

Si no configuras SMTP, el enlace de recuperación se escribe en **Logs** del proyecto (modo demostración).

## Desarrollo local

```bash
npm install
DATABASE_URL=postgres://postgres@localhost:5432/huellas \
JWT_SECRET=un-secreto-local-de-32-caracteres-o-mas \
COOKIE_INSEGURA=1 npm run dev
```

Abre http://localhost:3000.

## Estructura

```
api/auth/[accion].js     login, mfa, registro, logout, renovar, yo, olvide, restablecer, pregunta, responder
api/cuenta/[accion].js   perfil, password, pregunta, mfa-iniciar/activar/desactivar, sesiones, cerrar-sesion, cerrar-otras
api/admin/[accion].js    resumen, usuarios, crear-usuario, rol, estado, sesiones, cerrar-sesion, eventos
api/clinica/[accion].js  veterinarios, mascotas, mascota, mis-citas, cita, cancelar, agenda, atender
lib/                     db.js, auth.js, mfa.js, http.js, correo.js
middleware.js            protección de /admin, /veterinario, /cliente y /cuenta
public/                  páginas, estilos y scripts del navegador
```
