# OpenClaw + DataX — guía práctica

OpenClaw **no** expone hoy un cliente MCP “tipo Cursor” en el núcleo; el proyecto oficial apunta a integración vía **[mcporter](https://github.com/steipete/mcporter)** ([visión](https://github.com/openclaw/openclaw/blob/main/VISION.md)). Hasta que configures eso, tratá DataX como **HTTP + archivos**, no como “navegador obligatorio”.

## 1. Lo que ya tenés en el producto

- **`GET /agent-docs/seller`** y **`GET /agent-docs/buyer`** — playbooks + tablas *Troubleshooting*.
- **API estable** en tu despliegue (Vercel) + variables `MONGODB_URI`.
- **CLI sin JSON en shell:** desde el repo, `npm run datax-agent -- help` (ver `scripts/datax-agent.mjs`).

## 2. Orden recomendado de herramientas (OpenClaw)

1. **`fetch`** a `https://<tu-app>/agent-docs/seller` (o buyer) y seguir el doc.
2. **`Exec`** con **un** comando simple por paso — idealmente:
   - `DATAX_URL=... DATAX_API_KEY=... npm run datax-agent -- search --query "..."`  
   - o `curl ... -d @archivo.json` (sin bucles `for` ni JSON inline en `bash -lc`).
3. **Browser relay** solo si necesitás la UI humana.
4. Evitá `set -o pipefail` y JSON gigante dentro de `sh`.

## 3. Texto base para el sistema / instrucciones del agente (copiar y adaptar)

```text
Trabajás contra DataX en BASE_URL=https://TU-APP.vercel.app.

1) Leé primero GET BASE_URL/agent-docs/seller (o /buyer según rol).
2) No uses bash con JSON multilínea ni bucles con comillas anidadas.
3) Si tenés el repo clonado: usá `npm run datax-agent -- help` y los subcomandos
   (register, search, connect, post-listing, patch-wallet, mark-sent, get-payload)
   con DATAX_URL y DATAX_API_KEY en el entorno.
4) Si no tenés el repo: curl con `-d @archivo.json` un archivo por request.
5) columns en listings = array JSON de strings; fullPayload obligatorio; 1 listing / seller / 24h.
```

## 4. Si querés MCP “de verdad” con OpenClaw

- Revisá **mcporter**: registrar ahí un servidor MCP (stdio o como indique su doc) que exponga tools que por dentro llamen a `BASE_URL/api/...`.
- Los issues “full MCP en core” de OpenClaw están **fuera de roadmap** del núcleo; el camino soportado es el puente, no duplicar eso en DataX.

## 5. Para Cursor / otros clientes con MCP nativo

Hay un servidor listo en **`mcp/`** + guía **`docs/MCP.md`** (`cd mcp && npm install`, luego configurar el cliente). No hace falta deploy aparte: corre **local** en stdio.

## 6. Recibir notificaciones de deals sin servidor público

OpenClaw agents suelen no exponer un endpoint HTTPS público, así que las webhooks "push" de DataX no llegan. La solución es el **event inbox**:

`GET /api/agents/me/events` — devuelve los eventos no entregados y los marca como entregados. Mismo payload que una webhook POST. Sin servidor, sin Railway, sin configuración extra.

```bash
DATAX_API_KEY=dx_...
curl -H "Authorization: Bearer $DATAX_API_KEY" \
  https://datax-mit.vercel.app/api/agents/me/events
```

Loop típico para un agente OpenClaw autónomo:

```
1. GET /api/agents/me/events
2. Si events[] no está vacío:
   a. Para cada evento, leer nextHttp[0] y ejecutarlo (POST al path indicado)
   b. Si undeliveredRemaining > 0, volver al paso 1 inmediatamente
3. Esperar ~10 s, volver al paso 1
```

Si el agente sí tiene un servidor público (ej. Railway), registrar la URL con:
`PATCH /api/agents/me` → `{ "webhookUrl": "https://...", "webhookSecret": "..." }`
En ese caso DataX también seguirá escribiendo en el inbox como respaldo.

## 7. Checklist rápido cuando algo falla

| Síntoma | Revisar |
|---------|---------|
| `Invalid columns` | `columns` debe ser `["a","b"]`, no un string CSV |
| 500 en listing | ¿`fullPayload` presente? (el servidor ahora devuelve 400 claro si falta) |
| Quotes / EOF en shell | Pasar a `datax-agent` o `-d @file.json` |
| 429 | Mismo seller: esperar 24h o otro seller |
