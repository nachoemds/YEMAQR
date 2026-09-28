# Panel de códigos QR

QR dinámicos: el QR apunta a `tu-sitio.netlify.app/r/<codigo>`, que cuenta el escaneo y redirige al destino actual (editable).

## 1. Supabase (base de datos, gratis)
1. Crear cuenta en supabase.com → **New project** (guardá la contraseña de la DB, no la vas a usar acá).
2. Menú **SQL Editor** → pegar el contenido de `supabase.sql` → **Run**.
3. Copiar dos datos:
   - **Project URL** (`https://xxxx.supabase.co`) → `SUPABASE_URL`. La ves arriba en el botón **Connect**, o en **Project Settings → Data API**.
   - **Secret key** → `SUPABASE_SERVICE_KEY`. Está en **Project Settings → API Keys**, pestaña **Publishable and secret API keys**. Buscá la fila *secret* (`sb_secret_...`) y tocá el ojito para revelarla. Si solo ves un botón **Create new API keys**, tocalo primero.
   - Si tu proyecto es viejo y solo tiene la pestaña *Legacy*, podés usar la `service_role` de ahí; también funciona.

## 2. Subir el código a GitHub
Las Netlify Functions requieren deploy desde Git (o CLI); arrastrar la carpeta no las incluye.
1. Crear un repo **privado** en GitHub y subir el contenido de esta carpeta.

## 3. Netlify
1. **Add new site → Import from Git** → elegir el repo. No cambies nada del build (lo toma de `netlify.toml`).
2. **Site configuration → Environment variables** y agregar:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `ADMIN_PASSWORD` → la contraseña con la que vas a entrar al panel
   - `SESSION_SECRET` → una cadena larga al azar (30+ caracteres)
3. **Deploys → Trigger deploy** para que tome las variables.
4. Abrí `https://tu-sitio.netlify.app`, entrá con tu contraseña y creá el primer QR.

## Notas
- Nunca pongas la `service_role` key en el frontend ni en un repo público.
- Si borrás un QR, los ya impresos dejan de funcionar.
- Algunas apps de mensajería o antivirus "previsualizan" links y pueden sumar escaneos de más.
