-- Tabelas usadas pela API Node (server.js).
-- Opcional: o comando `npm start` já cria isso em initDb().
-- Pode coexistir com public.profiles / auth.users do schema.sql.

create extension if not exists pgcrypto;

create table if not exists public.ciclofit_users (
  id uuid primary key default gen_random_uuid(),
  name varchar(120) not null,
  email varchar(180) unique not null,
  password_hash varchar(64) not null,
  profile jsonb not null default '{}'::jsonb,
  role varchar(20) not null default 'student' check (role in ('admin','student')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.ciclofit_users add column if not exists profile jsonb not null default '{}'::jsonb;

create table if not exists public.ciclofit_state (
  user_id uuid primary key references public.ciclofit_users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ciclofit_admin_state (
  id boolean primary key default true check (id),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
