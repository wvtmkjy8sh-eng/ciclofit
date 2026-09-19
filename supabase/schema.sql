-- CicloFit - base inicial para a migração do modo local para Supabase
-- Execute no SQL Editor do Supabase.
-- Esta estrutura prepara autenticação e dados separados por usuário.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text unique,
  username text unique,
  phone text,
  birth_date date,
  weight numeric,
  height numeric,
  goal text,
  level text,
  max_hr integer,
  ftp integer,
  photo_path text,
  role text not null default 'student' check (role in ('admin','student')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Compatibilidade com instalações anteriores que já tinham perfis com e-mail obrigatório.
alter table public.profiles
  add column if not exists email text;

create unique index if not exists profiles_email_unique on public.profiles (email) where email is not null;

-- Versões antigas exigiam CPF. O login online usa e-mail, portanto novos
-- alunos podem não ter CPF informado sem invalidar registros existentes.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'cpf'
  ) then
    alter table public.profiles alter column cpf drop not null;
  end if;
end;
$$;

-- A instalação antiga usa `aluno`; o gatilho e o app online usam `student`.
-- Mantém os dois valores para não invalidar perfis já cadastrados.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'student', 'aluno'));

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.profiles(id) on delete set null,
  student_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  category text not null default 'gym',
  group_name text,
  duration text,
  intensity text,
  weekday integer,
  start_date date,
  valid_until date,
  note text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `create table if not exists` não altera tabelas de versões anteriores.
alter table public.workouts
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  workout_id uuid references public.workouts(id) on delete set null,
  workout_date date not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  ride_date date not null,
  ride_type text,
  distance_km numeric,
  duration_seconds integer,
  avg_speed numeric,
  elevation_gain numeric,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_state (
  scope_key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_health (
  id integer generated always as identity primary key,
  created_at timestamptz not null default now()
);
insert into public.app_health default values on conflict do nothing;

-- Todo cadastro feito por Supabase Auth cria automaticamente o perfil de aluno.
-- A função ignora qualquer role enviado pelo navegador para impedir autoelevação.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, username, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    new.email,
    nullif(new.raw_user_meta_data ->> 'username', ''),
    'student'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- RLS: base segura para a futura migração para Supabase Auth.
alter table public.profiles enable row level security;
alter table public.workouts enable row level security;
alter table public.workout_logs enable row level security;
alter table public.rides enable row level security;
alter table public.app_state enable row level security;
alter table public.app_health enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "app_state_own" on public.app_state;
drop policy if exists "workouts_select_own" on public.workouts;
drop policy if exists "workouts_insert_owner" on public.workouts;
drop policy if exists "workouts_update_owner" on public.workouts;
drop policy if exists "workouts_delete_owner" on public.workouts;
drop policy if exists "workout_logs_own" on public.workout_logs;
drop policy if exists "rides_own" on public.rides;
drop policy if exists "health_read" on public.app_health;

-- O próprio usuário pode ler/alterar o próprio perfil.
create policy "profiles_select_own" on public.profiles
for select to authenticated using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
for insert to authenticated with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Cada estado pertence exclusivamente ao usuário autenticado que o criou.
create policy "app_state_own" on public.app_state
for all to authenticated
using (scope_key = auth.uid()::text)
with check (scope_key = auth.uid()::text);

-- Alunos leem os próprios treinos; administradores serão ampliados via função/role na etapa 2.
create policy "workouts_select_own" on public.workouts
for select to authenticated using (student_id = auth.uid() or created_by = auth.uid());
create policy "workouts_insert_owner" on public.workouts
for insert to authenticated with check (created_by = auth.uid());
create policy "workouts_update_owner" on public.workouts
for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());
create policy "workouts_delete_owner" on public.workouts
for delete to authenticated using (created_by = auth.uid());

create policy "workout_logs_own" on public.workout_logs
for all to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());

create policy "rides_own" on public.rides
for all to authenticated using (student_id = auth.uid()) with check (student_id = auth.uid());

-- app_state/app_health ficam protegidos por padrão. O modo cloud-sync de teste só será
-- habilitado depois de definirmos políticas específicas para o ambiente de teste.
create policy "health_read" on public.app_health
for select to authenticated using (true);

-- Atualiza o cache do PostgREST imediatamente após criar as tabelas e políticas.
notify pgrst, 'reload schema';
