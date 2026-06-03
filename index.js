require('dotenv').config()
const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const { createClient } = require('@supabase/supabase-js')
const ws = require('ws')

// ─────────────────────────────────────────────────────────────────────────────
// Bandido Jewelry — Bot de WhatsApp
//
// Lee mensajes formateados que llegan a los grupos de WhatsApp y los guarda como
// leads en la tabla `customers` de Supabase. El admin los convierte en pedidos.
//
// Se conecta escaneando el QR (como WhatsApp Web). Debe correr SIEMPRE prendido.
// ─────────────────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
)

// IDs de los grupos de WhatsApp de Bandido (se configuran en el .env).
// Si no los tienes todavía, deja DEBUG_GROUPS=true para que el bot imprima
// el ID de cada grupo donde llegue un mensaje, y luego los copias aquí.
const GRUPO_VENTAS = process.env.GRUPO_VENTAS || ''
const GRUPO_CORTESIAS = process.env.GRUPO_CORTESIAS || ''
const DEBUG_GROUPS = process.env.DEBUG_GROUPS === 'true'

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox'] },
})

client.on('qr', (qr) => {
  console.log('\n📱 Escanea este QR con WhatsApp (Dispositivos vinculados):\n')
  qrcode.generate(qr, { small: true })
})

client.on('ready', () => {
  console.log('\n✅ Bot de Bandido conectado y escuchando...\n')
  if (!GRUPO_VENTAS && !GRUPO_CORTESIAS) {
    console.log('⚠️  No configuraste GRUPO_VENTAS ni GRUPO_CORTESIAS en el .env.')
    console.log('    Pon DEBUG_GROUPS=true, manda un mensaje al grupo y copia el ID que aparezca.\n')
  }
})

// Dedup en memoria (TTL 10 min)
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

  // Modo debug: imprime el ID de cualquier grupo para que lo copies al .env
  if (DEBUG_GROUPS && from.endsWith('@g.us')) {
    console.log('🔎 Grupo detectado → ID:', from)
  }

  if (recentMsgIds.has(msgId)) return
  if (from !== GRUPO_VENTAS && from !== GRUPO_CORTESIAS) return
  if (!body.includes('Nombre:') || !body.includes('WhatsApp:')) return

  console.log('📨 Lead recibido de:', from, '| Texto:', body.substring(0, 50))

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

  // Dedup por ventana de teléfono antes de insertar
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
        if (updErr) console.error('❌ Error actualizando lead:', updErr.message)
        else console.log('🔄 Lead actualizado con info más completa:', customer.full_name)
      } else {
        console.log('⏭️  Lead reciente igual o más completo, ignorando:', customer.full_name)
      }
      return
    }
  }

  // Insertar nuevo lead
  const { error } = await supabase.from('customers').insert([customer])
  if (error) {
    if (error.code === '23505') console.log('🔁 Duplicado ignorado por DB:', msgId)
    else console.error('❌ Error guardando:', error.message)
  } else {
    console.log('✅ Lead guardado:', customer.full_name, '| Categoría:', category)
  }
})

client.initialize()
