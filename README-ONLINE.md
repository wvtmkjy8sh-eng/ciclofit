# CicloFit — GitHub Pages + Supabase

O site estático abre no GitHub Pages. Login, alunos e sincronização vão direto ao Supabase Auth e ao Postgres, com RLS. Não precisa de Node nem Render.

## 1) SQL e Auth no Supabase

1. SQL Editor: execute `supabase/schema.sql` (inteiro).
2. Authentication → Providers: e-mail ligado. Em **URL Configuration**:
   - Site URL: `https://wvtmkjy8sh-eng.github.io/ciclofit/`
   - Redirect URLs: a mesma e `http://127.0.0.1:3001`
3. Authentication → Users → Add user: crie o admin (e-mail + senha, auto-confirm).
4. SQL Editor:

```sql
update public.profiles
set role = 'admin'
where email = 'SEU-ADMIN@email.com';
```

Alunos antigos em `ciclofit_users` (API Node) não entram sozinhos no Auth. Recrie-os no painel Admin depois do login.

## 2) Edge Functions (criar / editar / apagar aluno)

No PC, com [Supabase CLI](https://supabase.com/docs/guides/cli):

```powershell
cd C:\xampp\htdocs\ciclo-fit
npx supabase login
npx supabase link --project-ref SEU-REF
npx supabase functions deploy create-student --no-verify-jwt
npx supabase functions deploy manage-student --no-verify-jwt
```

`--no-verify-jwt` evita bloqueio no gateway; a função valida o JWT e o `role = admin` no código. As secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` já existem no projeto.

## 3) Chaves no frontend

Em `js/cloud-config.js` (já versionado) cole **Project URL** e **anon public**. Não use service_role.

Com as duas chaves preenchidas o app entra online; sem elas cai no modo local (`admin` / `admin123`, `aluno` / `1234`).

## 4) GitHub Pages

1. Push em `main`.
2. Repo → Settings → Pages → Deploy from a branch → `main` / `/ (root)`.
3. Abra `https://wvtmkjy8sh-eng.github.io/ciclofit/`.

O login do admin é o usuário criado no Auth, não o antigo `admin` local.

## API Node (opcional, só local)

`npm start` + `.env` com `DATABASE_URL` ainda sobe o Express antigo (`ciclofit_users`). O PWA publicado não usa essa API.
