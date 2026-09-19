import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers })
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers })

  try {
    const authorization = request.headers.get('Authorization')
    if (!authorization) throw new Error('Sessão não informada.')

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authorization } } }
    )
    const { data: { user }, error: userError } = await userClient.auth.getUser()
    if (userError || !user) throw new Error('Sessão inválida.')

    const { data: requester, error: profileError } = await userClient.from('profiles').select('role').eq('id', user.id).single()
    if (profileError || requester?.role !== 'admin') throw new Error('Apenas administradores podem gerenciar alunos.')

    const adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const body = await request.json().catch(() => ({}))
    const id = String(body.id || '').trim()
    const action = String(body.action || (body.password !== undefined || body.profile ? 'update' : 'delete')).toLowerCase()
    if (!id) throw new Error('Aluno não informado.')

    if (action === 'delete') {
      const { data: target, error: targetError } = await adminClient.from('profiles').select('id, role').eq('id', id).maybeSingle()
      if (targetError) throw targetError
      if (!target || target.role === 'admin') throw new Error('Aluno não encontrado.')
      const { error } = await adminClient.auth.admin.deleteUser(id)
      if (error) throw error
      return json({ ok: true })
    }

    const { data: existing, error: existingError } = await adminClient.from('profiles').select('*').eq('id', id).maybeSingle()
    if (existingError) throw existingError
    if (!existing || existing.role === 'admin') throw new Error('Aluno não encontrado.')

    const name = String(body.name || existing.name || '').trim()
    const email = String(body.email || existing.email || '').trim().toLowerCase()
    const password = String(body.password || '')
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {}
    if (!name || !email) throw new Error('Informe nome e e-mail.')

    const authPatch: Record<string, unknown> = { email, email_confirm: true }
    if (password) authPatch.password = password
    const { error: authError } = await adminClient.auth.admin.updateUserById(id, authPatch)
    if (authError) throw authError

    const extras = {
      ...(existing.extras && typeof existing.extras === 'object' ? existing.extras : {}),
      age: profile.age ?? existing.extras?.age ?? ''
    }

    const { data: updated, error: updateError } = await adminClient.from('profiles').update({
      name,
      email,
      username: String(body.username || email).trim(),
      phone: profile.phone ?? existing.phone,
      birth_date: profile.birthDate || existing.birth_date,
      weight: profile.weight === '' || profile.weight == null ? existing.weight : Number(profile.weight),
      height: profile.height === '' || profile.height == null ? existing.height : Number(profile.height),
      goal: profile.goal ?? existing.goal,
      level: profile.level ?? existing.level,
      max_hr: profile.maxHr === '' || profile.maxHr == null ? existing.max_hr : Number(profile.maxHr),
      ftp: profile.ftp === '' || profile.ftp == null ? existing.ftp : Number(profile.ftp),
      photo_path: profile.photo ?? existing.photo_path,
      extras,
      updated_at: new Date().toISOString()
    }).eq('id', id).select('*').single()
    if (updateError) throw updateError

    return json({ profile: updated })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao gerenciar aluno.'
    return json({ error: message }, 400)
  }
})
