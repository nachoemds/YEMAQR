// API del panel: login + CRUD de códigos QR
const crypto = require('crypto');

// Limpia espacios, barras finales y '/rest/v1' por si se pegó de más
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_DAYS = 30;

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

// ---------- sesión (token firmado, sin librerías) ----------
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return false;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()).exp > Date.now(); }
  catch { return false; }
}
function safeEqual(x, y) {
  const a = Buffer.from(String(x)), b = Buffer.from(String(y));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- Supabase (REST) ----------
// Las keys nuevas (sb_secret_...) no son JWT: van solo en 'apikey'.
// Las legacy (service_role, empiezan con eyJ) también necesitan 'Authorization'.
function authHeaders() {
  const h = { apikey: SUPABASE_KEY };
  if (!SUPABASE_KEY.startsWith('sb_')) h.Authorization = `Bearer ${SUPABASE_KEY}`;
  return h;
}
async function sb(path, options = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.message) || 'Error de base de datos');
  return data;
}

function randomCode(len = 6) {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
function normalizeUrl(u) {
  let v = String(u || '').trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { new URL(v); return v; } catch { return null; }
}

exports.handler = async (event) => {
  const route = (event.path || '').replace(/^.*\/api\/?/, '').replace(/\/$/, ''); // "login", "qrs", "qrs/abc123"
  const method = event.httpMethod;
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: 'JSON inválido' }); }

  try {
    // Login
    if (route === 'login' && method === 'POST') {
      if (!body.password || !safeEqual(body.password, ADMIN_PASSWORD)) {
        return json(401, { error: 'Contraseña incorrecta' });
      }
      return json(200, { token: sign({ exp: Date.now() + SESSION_DAYS * 864e5 }) });
    }

    // Todo lo demás requiere sesión
    const auth = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    if (!verify(auth)) return json(401, { error: 'Sesión vencida' });

    if (route === 'qrs' && method === 'GET') {
      return json(200, await sb('qr_codes?select=*&order=created_at.desc'));
    }

    if (route === 'qrs' && method === 'POST') {
      const destination = normalizeUrl(body.destination);
      if (!destination) return json(400, { error: 'URL no válida' });
      for (let i = 0; i < 5; i++) { // reintenta si el código ya existe
        try {
          const [row] = await sb('qr_codes', {
            method: 'POST',
            body: JSON.stringify({ code: randomCode(), destination }),
          });
          return json(201, row);
        } catch (e) {
          if (!/duplicate|unique/i.test(e.message)) throw e;
        }
      }
      return json(500, { error: 'No se pudo generar un código único' });
    }

    const m = route.match(/^qrs\/([A-Za-z0-9_-]+)$/);
    if (m && method === 'PATCH') {
      const destination = normalizeUrl(body.destination);
      if (!destination) return json(400, { error: 'URL no válida' });
      const rows = await sb(`qr_codes?code=eq.${m[1]}`, {
        method: 'PATCH',
        body: JSON.stringify({ destination, updated_at: new Date().toISOString() }),
      });
      return rows.length ? json(200, rows[0]) : json(404, { error: 'No existe' });
    }
    if (m && method === 'DELETE') {
      await sb(`qr_codes?code=eq.${m[1]}`, { method: 'DELETE' });
      return json(200, { ok: true });
    }

    return json(404, { error: 'Ruta no encontrada' });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
