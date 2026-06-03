# Bandido Jewelry — Bot de WhatsApp

Lee los mensajes formateados que llegan a los grupos de WhatsApp y los guarda como
leads en Supabase. El admin de Bandido los convierte automáticamente en pedidos.

> ⚠️ Este bot **debe correr siempre prendido** (en tu compu o un servidor).
> No funciona en Vercel porque mantiene una sesión de WhatsApp viva.

## Instalación

```bash
cd whatsapp-bot
npm install
cp .env.example .env
```

Edita `.env` y pon tu `SUPABASE_SERVICE_ROLE_KEY` (la encuentras en
Supabase → Settings → API → Secret keys).

## Descubrir los IDs de tus grupos (primera vez)

1. En `.env` pon `DEBUG_GROUPS=true`
2. Corre el bot: `npm start`
3. Escanea el QR con WhatsApp → Dispositivos vinculados
4. Manda un mensaje a tu grupo de ventas → la consola imprime su ID (termina en `@g.us`)
5. Copia ese ID a `GRUPO_VENTAS` en el `.env`. Repite para `GRUPO_CORTESIAS`.
6. Pon `DEBUG_GROUPS=false` y reinicia.

## Correr el bot

```bash
npm start
```

Escanea el QR una vez. Mientras la terminal siga abierta, el bot escucha los grupos
y guarda cada lead en Supabase. Los pedidos aparecen solos en el admin de Bandido.

## Formato de mensaje que el bot entiende

```
Nombre: Juan Pérez
WhatsApp: 5511223344
Ig: @juanp
Pago: $1200
Pedido: 2 cadenas miami, 1 anillo signet
Ubicación de Entrega: Calle Falsa 123, CDMX
```
