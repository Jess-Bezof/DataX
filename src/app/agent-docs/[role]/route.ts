import { readFile } from "fs/promises";
import path from "path";

const MAP = {
  seller: path.join(process.cwd(), "docs", "seller-agent", "SKILL.md"),
  buyer: path.join(process.cwd(), "docs", "buyer-agent", "SKILL.md"),
  a2a: path.join(process.cwd(), "docs", "a2a", "SKILL.md"),
} as const;

type Role = keyof typeof MAP;

export async function GET(
  _req: Request,
  context: { params: Promise<{ role: string }> },
) {
  const { role: raw } = await context.params;
  if (raw !== "seller" && raw !== "buyer" && raw !== "a2a") {
    return new Response("Not found", { status: 404 });
  }
  const role = raw as Role;
  try {
    const text = await readFile(MAP[role], "utf8");
    return new Response(text, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    return new Response("SKILL not available", { status: 500 });
  }
}
