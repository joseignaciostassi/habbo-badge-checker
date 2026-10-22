import { getSyncStatus, startSync } from "@/services/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Folder vs index, scan freshness and the running/last "Actualizar BD" job. */
export async function GET() {
  try {
    return Response.json(await getSyncStatus());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** Starts "Actualizar BD". Body: { allowMassMissing?: boolean, setup?: boolean }. Answers at once; poll GET. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!startSync({ allowMassMissing: body?.allowMassMissing === true, setup: body?.setup === true })) {
    return Response.json({ error: "Ya hay una actualización en curso." }, { status: 409 });
  }
  return Response.json(await getSyncStatus(), { status: 202 });
}
