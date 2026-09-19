import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Content-Type': 'application/json' }

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Sessão não informada.')

    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } })
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Sessão inválida.')

    const { data: requester, error: profileError } = await userClient.from('profiles').select('role').eq('id', user.id).single()
    if (profileError || requester?.role !== 'admin') throw new Error('Apenas administradores podem criar alunos.')

    const { name, email, password, username } = await request.json()
    if (!name || !email || !password || String(password).length < 6) throw new Error('Informe nome, e-mail e uma senha de pelo menos 6 caracteres.')

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: existing } = await adminClient.from('profiles').select('id').eq('username', String(username || email).trim()).maybeSingle()
    if (existing) throw new Error('Este e-mail/usuário já está cadastrado.')

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email: String(email).trim().toLowerCase(), password, email_confirm: true,
      user_metadata: { name: String(name).trim(), username: String(username || email).trim() }
    })
    if (createError || !created.user) throw createError || new Error('Não foi possível criar a conta.')

    const { data: profile, error: newProfileError } = await adminClient.from('profiles').select('*').eq('id', created.user.id).single()
    if (newProfileError) throw newProfileError
    return new Response(JSON.stringify({ profile }), { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao criar aluno.'
    return new Response(JSON.stringify({ error: message }), { status: 400, headers })
  }
})