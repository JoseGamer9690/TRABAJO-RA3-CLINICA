// Conexión a PostgreSQL (Neon en Vercel) y creación automática del esquema.
import pg from 'pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
const esLocal = connectionString && /localhost|127\.0\.0\.1/.test(connectionString);

// Se reutiliza el pool entre invocaciones de la misma instancia (fluid compute).
const pool = globalThis.__hbPool || new pg.Pool({
  connectionString,
  ssl: esLocal ? false : { rejectUnauthorized: false },
  max: 3,
});
globalThis.__hbPool = pool;

export const query = (text, params) => pool.query(text, params);

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id              SERIAL PRIMARY KEY,
  usuario         VARCHAR(40)  UNIQUE NOT NULL,
  correo          VARCHAR(120) UNIQUE NOT NULL,
  nombre          VARCHAR(120) NOT NULL,
  telefono        VARCHAR(20),
  password_hash   TEXT NOT NULL,
  rol             VARCHAR(20) NOT NULL CHECK (rol IN ('admin','veterinario','cliente')),
  activo          BOOLEAN NOT NULL DEFAULT TRUE,
  pregunta        TEXT,
  respuesta_hash  TEXT,
  mfa_activo      BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secreto     TEXT,
  mfa_pendiente   TEXT,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta TIMESTAMPTZ,
  intentos_pregunta INT NOT NULL DEFAULT 0,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sesiones (
  id            UUID PRIMARY KEY,
  usuario_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL,
  recordar      BOOLEAN NOT NULL DEFAULT FALSE,
  agente        TEXT,
  ip            TEXT,
  creada_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_en     TIMESTAMPTZ NOT NULL,
  revocada_en   TIMESTAMPTZ,
  motivo        VARCHAR(40)
);
CREATE INDEX IF NOT EXISTS idx_sesiones_usuario ON sesiones(usuario_id);
CREATE TABLE IF NOT EXISTS tokens_recuperacion (
  id          SERIAL PRIMARY KEY,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expira_en   TIMESTAMPTZ NOT NULL,
  usado_en    TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS eventos (
  id          SERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  tipo        VARCHAR(40) NOT NULL,
  detalle     TEXT,
  ip          TEXT,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mascotas (
  id          SERIAL PRIMARY KEY,
  dueno_id    INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre      VARCHAR(60) NOT NULL,
  especie     VARCHAR(30) NOT NULL,
  raza        VARCHAR(60),
  edad        INT
);
CREATE TABLE IF NOT EXISTS citas (
  id              SERIAL PRIMARY KEY,
  mascota_id      INT NOT NULL REFERENCES mascotas(id) ON DELETE CASCADE,
  cliente_id      INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  veterinario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
  fecha           TIMESTAMPTZ NOT NULL,
  motivo          TEXT NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','atendida','cancelada')),
  notas           TEXT
);
`;

let listo = globalThis.__hbListo;

// Crea las tablas y los usuarios de demostración una sola vez por instancia.
export async function asegurarEsquema() {
  if (listo) return listo;
  listo = (async () => {
    await pool.query(ESQUEMA);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
    if (rows[0].n === 0) {
      const pass = process.env.SEED_PASSWORD || 'Huellas#2026';
      const hash = await bcrypt.hash(pass, 10);
      const resp = await bcrypt.hash('bravo', 10);
      const demo = [
        ['admin', 'admin@huellasdelbravo.mx', 'Administración General', 'admin'],
        ['dra.sofia', 'sofia@huellasdelbravo.mx', 'Dra. Sofía Márquez', 'veterinario'],
        ['dr.luis', 'luis@huellasdelbravo.mx', 'Dr. Luis Carrillo', 'veterinario'],
        ['cliente', 'cliente@huellasdelbravo.mx', 'Cliente de Prueba', 'cliente'],
      ];
      for (const [u, c, n, r] of demo) {
        await pool.query(
          `INSERT INTO usuarios (usuario, correo, nombre, password_hash, rol, pregunta, respuesta_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [u, c, n, hash, r, '¿Cuál es el nombre del río de tu ciudad?', resp]
        );
      }
    }
  })();
  globalThis.__hbListo = listo;
  try { await listo; } catch (e) { listo = globalThis.__hbListo = null; throw e; }
  return listo;
}
