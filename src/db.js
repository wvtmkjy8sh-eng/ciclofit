import pg from 'pg';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
export const hashPassword = password => crypto.createHash('sha256').update(password).digest('hex');

export async function initDb() {
  await pool.query(`
    create table if not exists ciclofit_users (
      id uuid primary key default gen_random_uuid(),
      name varchar(120) not null,
      email varchar(180) unique not null,
      password_hash varchar(64) not null,
      profile jsonb not null default '{}'::jsonb,
      role varchar(20) not null default 'student' check (role in ('admin','student')),
      active boolean not null default true,
      created_at timestamptz not null default now()
    );
    alter table ciclofit_users add column if not exists profile jsonb not null default '{}'::jsonb;
    create table if not exists ciclofit_state (
      user_id uuid primary key references ciclofit_users(id) on delete cascade,
      payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table if not exists ciclofit_admin_state (
      id boolean primary key default true check (id),
      payload jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
  `);
  const email = String(process.env.CICLOFIT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.CICLOFIT_ADMIN_PASSWORD || '');
  if (email && password.length >= 6) {
    await pool.query(
      "insert into ciclofit_users(name,email,password_hash,role) values('Administrador',$1,$2,'admin') on conflict(email) do nothing",
      [email, hashPassword(password)]
    );
  }
}