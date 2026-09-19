# CicloFit — banco no Supabase

O navegador não fala direto com o Postgres. Ele chama a API Node (`server.js`), e a API grava no PostgreSQL do seu projeto Supabase.

Tabelas da API: `ciclofit_users`, `ciclofit_state`, `ciclofit_admin_state`.
O arquivo `supabase/schema.sql` (profiles + Auth) é outro modelo e não é usado por este login.

## 1) Connection string no Supabase

1. Abra o projeto em [supabase.com](https://supabase.com).
2. **Project Settings → Database → Connect**.
3. Copie a **URI** (mode Session pooler, porta `6543`, ou Direct, porta `5432`).
4. Troque `[YOUR-PASSWORD]` pela senha do banco (a que você definiu ao criar o projeto).

## 2) Arquivo `.env` na raiz do app

Copie `.env.example` para `.env` e preencha:

- `DATABASE_URL` — URI do passo 1
- `JWT_SECRET` — um texto longo qualquer
- `PORT=3001`
- `CICLOFIT_ADMIN_EMAIL` e `CICLOFIT_ADMIN_PASSWORD` — primeiro admin (e-mail + senha com 6+ caracteres)

Não commite o `.env`.

## 3) Subir o app com o banco

```powershell
cd C:\xampp\htdocs\ciclo-fit
npm install
npm start
```

Abra **http://127.0.0.1:3001** (não use só o XAMPP/Apache: a API `/api` precisa do Node).

No primeiro start as tabelas são criadas e o admin do `.env` é inserido.

## 4) Login

Aba **ADMIN**: o e-mail e a senha de `CICLOFIT_ADMIN_*`.

Aba **ALUNO**: contas criadas no painel Admin → Criar acesso (e-mail + senha).

Com o banco no ar o app deixa o modo local (`admin` / `aluno`) e usa o Postgres.

## 5) Publicar (Render + GitHub)

O jeito mais simples: um único serviço Node. Ele entrega o site e a API, e o banco continua no Supabase.

1. Envie o código para o GitHub (`main`).
2. Em [render.com](https://render.com), faça login com GitHub.
3. **New → Blueprint** e selecione o repositório, ou **New → Web Service** apontando para `ciclofit`.
4. Build: `npm install` · Start: `npm start`.
5. Em Environment, cole as mesmas variáveis do `.env` local:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `CICLOFIT_ADMIN_EMAIL`
   - `CICLOFIT_ADMIN_PASSWORD`
6. Deploy. A URL fica `https://ciclofit-xxxx.onrender.com`.
7. Abra essa URL (não o GitHub Pages). O `apiUrl` vazio usa a mesma origem.

O plano free do Render pode hibernar após inatividade; o primeiro acesso depois disso demora ~30–50s.
