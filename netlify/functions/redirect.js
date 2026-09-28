// GET /r/<codigo>  ->  suma 1 escaneo y redirige (302) al destino actual
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  const code = decodeURIComponent((event.path || '').split('/').filter(Boolean).pop() || '');

  if (!/^[A-Za-z0-9_-]{3,32}$/.test(code)) return notFound();

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/register_scan`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        // keys nuevas (sb_secret_...) no son JWT: solo 'apikey'
        ...(SUPABASE_KEY.startsWith('sb_') ? {} : { Authorization: `Bearer ${SUPABASE_KEY}` }),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_code: code }),
    });
    if (!res.ok) return notFound();
    const destination = await res.json(); // string o null
    if (!destination) return notFound();

    return {
      statusCode: 302,
      headers: { Location: destination, 'Cache-Control': 'no-store' },
      body: '',
    };
  } catch (e) {
    return { statusCode: 500, body: 'Error temporal, probá de nuevo.' };
  }
};

function notFound() {
  return {
    statusCode: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
    body: '<meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:40px;text-align:center"><h2>Este código QR no existe o fue eliminado.</h2></body>',
  };
}
