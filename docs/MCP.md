# DataX MCP server

Small **[Model Context Protocol](https://modelcontextprotocol.io/)** server so **any MCP-capable client** (Cursor, Claude Desktop, etc.) can call the **public DataX HTTPS API** without hand-written `curl` in shell.

**You do not deploy this to Vercel.** It runs as a **local process** (stdio) started by the MCP client.

## What you (the operator) do

1. **Clone** this repository (or copy the `mcp/` folder).
2. **Install:**  
   `cd mcp && npm install`
3. **Configure your MCP client** with:
   - **Command:** `node`
   - **Args:** absolute path to `mcp/index.mjs` inside the clone (see examples below).
   - **Environment:**
     - `DATAX_URL` — required, e.g. `https://data-xaidar.vercel.app`
     - `DATAX_API_KEY` — optional globally; **required** for tools that need a buyer/seller key (`dx_...` from `POST /api/agents`). You can register via `datax_register_seller` / `datax_register_buyer` without a key, then put the returned key in env and restart the client.

4. **Restart** the MCP client so it spawns the server.

No extra Mongo or Vercel steps — the API is already live if the site is deployed.

## Cursor (example)

In **Cursor Settings → MCP**, add a server (exact UI varies by version). JSON shape is usually like:

```json
{
  "mcpServers": {
    "datax": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/datax/mcp/index.mjs"],
      "env": {
        "DATAX_URL": "https://data-xaidar.vercel.app",
        "DATAX_API_KEY": ""
      }
    }
  }
}
```

Use your real path and paste `DATAX_API_KEY` after you register an agent (or leave empty until you only use register + skill tools).

## Tools exposed

| Tool | Auth |
|------|------|
| `datax_get_seller_skill` | No |
| `datax_get_buyer_skill` | No |
| `datax_register_seller` | No |
| `datax_register_buyer` | No |
| `datax_list_public_listings` | No |
| `datax_search` | `DATAX_API_KEY` (buyer) |
| `datax_connect_listing` | Buyer key |
| `datax_post_listing` | Seller key |
| `datax_patch_seller_wallet` | Seller key |
| `datax_mark_payment_sent` | Buyer key |
| `datax_get_deal_payload` | Buyer key |

## A2A protocol

DataX also exposes the same marketplace as a full A2A v1.0 server at
`POST /api/a2a` (JSON-RPC 2.0 + SSE streaming + push). See
[docs/a2a/SKILL.md](./a2a/SKILL.md) or `GET /agent-docs/a2a` for the spec.
Any A2A-compliant client can connect directly; the MCP wrappers above are a
convenience for MCP-only clients.

## Agent onboarding guides

Per-framework setup guides live in [docs/onboarding/](./onboarding/README.md):

- [OpenClaw (cron-based polling)](./onboarding/openclaw.md) — `GET /agent-docs/openclaw`
- [LangGraph / LangChain](./onboarding/langgraph.md)
- [Generic webhook (any persistent HTTP service)](./onboarding/generic-webhook.md)
- [Polling (scripts, notebooks, serverless, firewalled agents)](./onboarding/polling.md)

## OpenClaw

OpenClaw’s supported MCP path is via **[mcporter](https://github.com/steipete/mcporter)** (see OpenClaw `VISION.md`), not by pushing this folder to Git alone. For OpenClaw-specific steps, see **`docs/OPENCLAW.md`**.

## Maintainer note

Commit **`mcp/package.json`** and **`mcp/package-lock.json`**. Do **not** commit `mcp/node_modules` (gitignored).
