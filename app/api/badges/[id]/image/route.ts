import { PgBadgeRepository } from "@/data/badgeRepo";
import { getImageStore } from "@/storage/localFsStore";

export const runtime = "nodejs";

/** Serves the original badge file (format sniffed from content, not extension). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return new Response("Bad id", { status: 400 });

  const badge = await new PgBadgeRepository().getBadge(id);
  if (!badge) return new Response("Not found", { status: 404 });

  const data = await getImageStore().read(badge.fileName);
  const type = data.subarray(0, 4).toString("hex") === "89504e47" ? "image/png" : "image/gif";
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=3600" },
  });
}
