require('dotenv').config()
const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
})

client.on('qr', (qr) => {
  console.log('Escanea este QR con tu WhatsApp:')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('✅ Bot conectado y escuchando...')
})

const GRUPO_CORTESIAS = '120363424985329640@g.us'
const GRUPO_VENTAS = '120363424470342719@g.us'

// In-memory dedup of message IDs (TTL = 10 min)
const recentMsgIds = new Set()
const RECENT_MSG_TTL_MS = 10 * 60 * 1000
function rememberMsgId(id) {
  recentMsgIds.add(id)
  setTimeout(() => recentMsgIds.delete(id), RECENT_MSG_TTL_MS)
}

client.on('message', async (msg) => {
  const body = msg.body
  const from = msg.from
  const msgId = msg.id?._serialized

  if (!msgId) return
  if (recentMsgIds.has(msgId)) {
    console.log('🔁 Mensaje ya procesado, ignorando:', msgId)
    return
  }

  console.log('📨 Mensaje recibido de:', from, '| Texto:', body.substring(0, 50))

  if (from !== GRUPO_CORTESIAS && from !== GRUPO_VENTAS) return
  if (!body.includes('Nombre:') || !body.includes('WhatsApp:')) return

  const extract = (label, text) => {
    const regex = new RegExp(`${label}:\\s*(.+)`)
    const match = text.match(regex)
    return match ? match[1].trim() : null
  }

  const paymentType = extract('Pago', body) || ''
  const category = paymentType.includes('$') ? 'venta' : 'cortesia'
  const source = from === GRUPO_VENTAS ? 'whatsapp_ventas' : 'whatsapp_cortesias'

  const firstOrderMatch = body.match(/Pedido:\s*([\s\S]*?)(?=Ubicación de Entrega:|$)/i)
  const first_order = firstOrderMatch ? firstOrderMatch[1].trim() : null

  const addressMatch = body.match(/Ubicación de Entrega:\s*([\s\S]*?)$/i)
  const delivery_address = addressMatch
    ? addressMatch[1].replace(/👇[\u{1F3FB}-\u{1F3FF}\s]*/gu, '').trim()
    : null

  const customer = {
    full_name: extract('Nombre', body),
    whatsapp: extract('WhatsApp', body),
    instagram: extract('Ig', body),
    payment_type: paymentType,
    first_order,
    delivery_address,
    category,
    source,
    whatsapp_msg_id: msgId,
  }

  rememberMsgId(msgId)

  // ── Phone-window dedup before insert ──────────────────────────
  if (customer.whatsapp) {
    const windowStart = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: recentRows, error: recentErr } = await supabase
      .from('customers')
      .select('id, first_order')
      .eq('whatsapp', customer.whatsapp)
      .gte('created_at', windowStart)
      .order('created_at', { ascending: false })
      .limit(1)

    if (recentErr) {
      console.error('⚠️  Error consultando duplicados:', recentErr.message)
    } else if (recentRows && recentRows.length > 0) {
      const existing = recentRows[0]
      const existingLen = (existing.first_order || '').length
      const incomingLen = (customer.first_order || '').length

      if (incomingLen > existingLen) {
        const { error: updErr } = await supabase
          .from('customers')
          .update({
            first_order: customer.first_order,
            payment_type: customer.payment_type,
            delivery_address: customer.delivery_address,
            category: customer.category,
            whatsapp_msg_id: msgId,
          })
          .eq('id', existing.id)

        if (updErr) {
          console.error('❌ Error actualizando cliente existente:', updErr.message)
        } else {
          console.log('🔄 Cliente existente actualizado con info más completa:', customer.full_name)
        }
      } else {
        console.log('⏭️  Ya existe cliente reciente con info igual o más completa, ignorando:', customer.full_name)
      }
      return
    }
  }

  // ── No recent match — INSERT normally ─────────────────────────
  const { error } = await supabase
    .from('customers')
    .insert([customer])

  if (error) {
    if (error.code === '23505') {
      console.log('🔁 Duplicado ignorado por DB:', msgId)
    } else {
      console.error('❌ Error guardando:', error.message)
    }
  } else {
    console.log('✅ Cliente guardado:', customer.full_name, '| Categoría:', category)
  }
})

client.initialize()
