-- Pegar en Supabase > SQL Editor > Run
-- Seguro de re-correr: no borra usuarios ni códigos ya creados.

create extension if not exists pgcrypto;

create table if not exists qr_codes (
  code        text primary key,
  destination text not null,
  scans       integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Si la tabla ya existía (panel creado antes de esta versión), agrega
-- las columnas nuevas sin tocar los datos que ya tenés.
alter table qr_codes add column if not exists title  text;
alter table qr_codes add column if not exists folder text;
alter table qr_codes add column if not exists last_scanned_at timestamptz;

-- ---------- Usuarios ----------
create table if not exists users (
  username      text primary key,
  password_hash text,
  is_admin      boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Columna de "entrada": escribís la contraseña en texto plano acá.
-- El trigger de abajo la hashea sola al toque y borra el texto plano,
-- así nunca queda guardada legible en la tabla.
alter table users add column if not exists password text;

create or replace function hash_user_password()
returns trigger
language plpgsql
as $$
begin
  if new.password is not null and new.password <> '' then
    new.password_hash := crypt(new.password, gen_salt('bf'));
    new.password := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_hash_password on users;
create trigger trg_hash_password
before insert or update on users
for each row execute function hash_user_password();

-- Chequea usuario + contraseña en una sola operación (para el login)
create or replace function verify_login(p_username text, p_password text)
returns table(username text, is_admin boolean)
language sql
as $$
  select u.username, u.is_admin
    from users u
   where u.username = p_username
     and u.password_hash is not null
     and u.password_hash = crypt(p_password, u.password_hash)
$$;

-- Cada código le pertenece a un usuario
alter table qr_codes add column if not exists owner text references users(username);

-- Seguridad: bloquea el acceso directo desde el navegador.
-- Solo las funciones de Netlify (con la service key) pueden leer/escribir.
alter table qr_codes enable row level security;
alter table users    enable row level security;

-- Suma +1 y devuelve el destino en una sola operación (atómico)
create or replace function register_scan(p_code text)
returns text
language sql
as $$
  update qr_codes
     set scans = scans + 1,
         last_scanned_at = now()
   where code = p_code
  returning destination;
$$;

-- ---------- Cómo crear un usuario ----------
-- No lo corras acá arriba: hacelo aparte, en el SQL Editor, una vez que
-- ya ejecutaste todo lo de este archivo. Cambiá 'blacko' y 'mi-contraseña'.
--
-- insert into users (username, password, is_admin) values ('blacko', 'mi-contraseña', true);
--
-- Para los usuarios normales (no admin):
-- insert into users (username, password, is_admin) values ('usuario1', 'clave1', false);
--
-- La columna "password" queda vacía sola después de guardar: es normal,
-- ahí solo vive un instante mientras el trigger la hashea.
