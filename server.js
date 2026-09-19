import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDb, pool, hashPassword } from './src/db.js';

dotenv.config();
const app = express();
const port = process.env.PORT || 3001;
const secret = process.env.JWT_SECRET;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!secret) throw new Error('JWT_SECRET não configurado.');
app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(express.static(__dirname));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Não autenticado.' });
  try { req.user = jwt.verify(token, secret); next(); }
  catch { res.status(401).json({ error: 'Sessão inválida.' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, username: user.email, role: user.role, active: user.active, profile: user.profile || {} }; }
function tokenFor(user) { return jwt.sign({ id: user.id, role: user.role, email: user.email }, secret, { expiresIn: '8h' }); }

app.get('/api/health', async (_req, res) => {
  try { await pool.query('select 1'); res.json({ ok: true, database: true }); }
  catch { res.status(503).json({ ok: false, database: false }); }
});
app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  const { rows } = await pool.query('select * from ciclofit_users where email=$1 and active=true', [email]);
  const user = rows[0];
  if (!user || user.password_hash !== hashPassword(password)) return res.status(401).json({ error: 'Credenciais inválidas.' });
  res.json({ token: tokenFor(user), user: publicUser(user) });
});
app.get('/api/auth/session', auth, async (req, res) => {
  const { rows } = await pool.query('select * from ciclofit_users where id=$1 and active=true', [req.user.id]);
  if (!rows[0]) return res.status(401).json({ error: 'Sessão inválida.' });
  res.json({ user: publicUser(rows[0]) });
});
app.post('/api/auth/register', async (req, res) => {
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  if (!name || !email || password.length < 6) return res.status(400).json({ error: 'Informe nome, e-mail e senha de ao menos 6 caracteres.' });
  try {
    const { rows } = await pool.query("insert into ciclofit_users(name,email,password_hash,role) values($1,$2,$3,'student') returning *", [name, email, hashPassword(password)]);
    res.status(201).json({ token: tokenFor(rows[0]), user: publicUser(rows[0]) });
  } catch (error) { res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar a conta.' }); }
});
app.get('/api/admin/users', auth, adminOnly, async (_req, res) => {
  const { rows } = await pool.query("select id,name,email,role,active,profile,created_at from ciclofit_users where role='student' order by created_at desc");
  res.json(rows.map(publicUser));
});
app.post('/api/admin/users', auth, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim(), email = String(req.body?.email || '').trim().toLowerCase(), password = String(req.body?.password || '');
  if (!name || !email || password.length < 6) return res.status(400).json({ error: 'Informe nome, e-mail e senha de ao menos 6 caracteres.' });
  try {
    const { rows } = await pool.query("insert into ciclofit_users(name,email,password_hash,role) values($1,$2,$3,'student') returning *", [name, email, hashPassword(password)]);
    res.status(201).json(publicUser(rows[0]));
  } catch (error) { res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Este e-mail já está cadastrado.' : 'Não foi possível criar a conta.' }); }
});
app.delete('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query("delete from ciclofit_users where id=$1 and role='student' returning id", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Aluno não encontrado.' });
  res.json({ ok: true });
});
app.patch('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  if (!name || !email) return res.status(400).json({ error: 'Informe nome e e-mail.' });
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      `update ciclofit_users set name=$1,email=$2,password_hash=case when $3='' then password_hash else $4 end,profile=coalesce($6,profile)
       where id=$5 and role='student' returning *`,
      [name, email, password, password ? hashPassword(password) : '', req.params.id, req.body?.profile || null]
    );
    if (!rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Aluno não encontrado.' }); }
    if (req.body?.profile && typeof req.body.profile === 'object') {
      await client.query(
        `insert into ciclofit_state(user_id,payload,updated_at) values($1,jsonb_build_object('profile',$2::jsonb),now())
         on conflict(user_id) do update set payload=jsonb_set(coalesce(ciclofit_state.payload,'{}'::jsonb),'{profile}',$2::jsonb,true),updated_at=now()`,
        [req.params.id, JSON.stringify(rows[0].profile || req.body.profile)]
      );
    }
    await client.query('commit');
    res.json(publicUser(rows[0]));
  } catch (error) { try { await client.query('rollback'); } catch {} res.status(error.code === '23505' ? 409 : 500).json({ error: error.code === '23505' ? 'Este e-mail já está cadastrado.' : 'Não foi possível atualizar o aluno.' }); }
  finally { client.release(); }
});
app.get('/api/profile', auth, async (req, res) => {
  const { rows } = await pool.query('select * from ciclofit_users where id=$1 and active=true', [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Usuário não encontrado.' });
  res.json(publicUser(rows[0]));
});
app.put('/api/profile', auth, async (req, res) => {
  const incoming = req.body?.profile;
  if (!incoming || typeof incoming !== 'object') return res.status(400).json({ error: 'Perfil inválido.' });
  const profile = { ...incoming };
  const name = String(profile.name || '').trim();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query(
      'update ciclofit_users set name=coalesce(nullif($1,\'\'),name),profile=$2 where id=$3 returning *',
      [name, profile, req.user.id]
    );
    if (!rows[0]) { await client.query('rollback'); return res.status(404).json({ error: 'Usuário não encontrado.' }); }
    await client.query(
      `insert into ciclofit_state(user_id,payload,updated_at) values($1,jsonb_build_object('profile',$2::jsonb),now())
       on conflict(user_id) do update set payload=jsonb_set(coalesce(ciclofit_state.payload,'{}'::jsonb),'{profile}',$2::jsonb,true),updated_at=now()`,
      [req.user.id, JSON.stringify(profile)]
    );
    await client.query('commit');
    res.json(publicUser(rows[0]));
  } catch (error) { try { await client.query('rollback'); } catch {} res.status(500).json({ error: 'Não foi possível salvar o perfil.' }); }
  finally { client.release(); }
});
app.get('/api/state', auth, async (req, res) => {
  const { rows } = await pool.query('select payload,updated_at from ciclofit_state where user_id=$1', [req.user.id]);
  res.json(rows[0] || null);
});
app.put('/api/state', auth, async (req, res) => {
  const payload = req.body?.payload || {};
  await pool.query(
    'insert into ciclofit_state(user_id,payload,updated_at) values($1,$2,now()) on conflict(user_id) do update set payload=excluded.payload,updated_at=now()',
    [req.user.id, payload]
  );
  if (payload.profile && typeof payload.profile === 'object') {
    await pool.query('update ciclofit_users set name=coalesce(nullif($1,\'\'),name),profile=$2 where id=$3', [String(payload.profile.name || ''), payload.profile, req.user.id]);
  }
  if (req.user.role === 'admin') {
    const shared = { adminUsers: payload.adminUsers || [], adminWorkouts: payload.adminWorkouts || [], customExercises: payload.customExercises || [], customWorkouts: payload.customWorkouts || [], adminNotifs: payload.adminNotifs || [] };
    await pool.query('insert into ciclofit_admin_state(id,payload,updated_at) values(true,$1,now()) on conflict(id) do update set payload=excluded.payload,updated_at=now()', [shared]);
  }
  res.json({ ok: true });
});
app.get('/api/shared-state', auth, async (_req, res) => {
  const { rows } = await pool.query('select payload,updated_at from ciclofit_admin_state where id=true');
  res.json(rows[0] || null);
});
app.put('/api/shared-state', auth, adminOnly, async (req, res) => {
  const payload = req.body?.payload || {};
  await pool.query(
    'insert into ciclofit_admin_state(id,payload,updated_at) values(true,$1,now()) on conflict(id) do update set payload=excluded.payload,updated_at=now()',
    [payload]
  );
  res.json({ ok: true });
});
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

initDb().then(() => app.listen(port, '0.0.0.0', () => console.log(`CicloFit em http://127.0.0.1:${port}`))).catch(error => { console.error(error); process.exit(1); });