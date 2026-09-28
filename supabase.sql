-- Pegar en Supabase > SQL Editor > Run

create table if not exists qr_codes (
  code        text primary key,
  destination text not null,
  scans       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seguridad: bloquea el acceso directo desde el navegador.
-- Solo las funciones de Netlify (con la service key) pueden leer/escribir.
alter table qr_codes enable row level security;

-- Suma +1 y devuelve el destino en una sola operación (atómico)
create or replace function register_scan(p_code text)
returns text
language sql
as $$
  update qr_codes
     set scans = scans + 1
   where code = p_code
  returning destination;
$$;
