// API del panel: login (usuario+contraseña) + CRUD de códigos QR,
// filtrado por dueño salvo para usuarios admin.
const crypto = require('crypto');

// Limpia espacios, barras finales y '/rest/v1' por si se pegó de más
const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim().replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '');
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const SESSION_SECRET = process.env.SESSION_SECRET;
const SESSION_DAYS = 30;

const json = (statusCode, data) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(data),
});

// ---------- sesión (token firmado, sin librerías) ----------
// El payload lleva quién es el usuario y si es admin, para poder filtrar
// qué códigos puede ver o tocar sin volver a preguntarle a la base cada vez.
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifySession(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload.username || payload.exp <= Date.now()) return null;
    return payload; // { username, isAdmin, exp }
  } catch { return null; }
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
function normalizeText(v, maxLen) {
  const s = String(v == null ? '' : v).trim().slice(0, maxLen);
  return s || null;
}
// username va en la URL como filtro: nada de comillas ni espacios raros
function normalizeUsername(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^[a-z0-9_-]{2,40}$/.test(s) ? s : null;
}

exports.handler = async (event) => {
  const route = (event.path || '').replace(/^.*\/api\/?/, '').replace(/\/$/, ''); // "login", "qrs", "qrs/abc123"
  const method = event.httpMethod;
  let body = {};
  try { body = event.body ? JSON.parse(event.body) : {}; } catch { return json(400, { error: 'JSON inválido' }); }

  try {
    // ---------- Login ----------
    if (route === 'login' && method === 'POST') {
      const username = normalizeUsername(body.username);
      if (!username || !body.password) return json(401, { error: 'Usuario o contraseña incorrectos' });

      const rows = await sb('rpc/verify_login', {
        method: 'POST',
        body: JSON.stringify({ p_username: username, p_password: String(body.password) }),
      });
      if (!rows || !rows.length) return json(401, { error: 'Usuario o contraseña incorrectos' });

      const isAdmin = !!rows[0].is_admin;
      const token = sign({ username, isAdmin, exp: Date.now() + SESSION_DAYS * 864e5 });
      return json(200, { token, username, isAdmin });
    }

    // Todo lo demás requiere sesión
    const auth = (event.headers.authorization || event.headers.Authorization || '').replace('Bearer ', '');
    const session = verifySession(auth);
    if (!session) return json(401, { error: 'Sesión vencida' });
    const { username, isAdmin } = session;
    // Filtro por dueño para todo lo que no sea admin (se agrega a la query de Supabase)
    const ownerFilter = isAdmin ? '' : `&owner=eq.${encodeURIComponent(username)}`;

    if (route === 'qrs' && method === 'GET') {
      return json(200, await sb(`qr_codes?select=*&order=created_at.desc${ownerFilter}`));
    }

    if (route === 'qrs' && method === 'POST') {
      const destination = normalizeUrl(body.destination);
      if (!destination) return json(400, { error: 'URL no válida' });
      const title = normalizeText(body.title, 120);
      const folder = normalizeText(body.folder, 60);
      for (let i = 0; i < 5; i++) { // reintenta si el código ya existe
        try {
          const [row] = await sb('qr_codes', {
            method: 'POST',
            body: JSON.stringify({ code: randomCode(), destination, title, folder, owner: username }),
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
      const patch = { updated_at: new Date().toISOString() };
      if ('destination' in body) {
        const destination = normalizeUrl(body.destination);
        if (!destination) return json(400, { error: 'URL no válida' });
        patch.destination = destination;
      }
      if ('title' in body) patch.title = normalizeText(body.title, 120);
      if ('folder' in body) patch.folder = normalizeText(body.folder, 60);
      const rows = await sb(`qr_codes?code=eq.${m[1]}${ownerFilter}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      return rows.length ? json(200, rows[0]) : json(404, { error: 'No existe, o no es tuyo' });
    }
    if (m && method === 'DELETE') {
      const rows = await sb(`qr_codes?code=eq.${m[1]}${ownerFilter}`, { method: 'DELETE' });
      return (rows && rows.length) ? json(200, { ok: true }) : json(404, { error: 'No existe, o no es tuyo' });
    }

    return json(404, { error: 'Ruta no encontrada' });
  } catch (e) {
    return json(500, { error: e.message });
  }
};
