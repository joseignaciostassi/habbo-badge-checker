import { NextResponse } from "next/server";
import { config } from "@/config";
import { PgBadgeRepository } from "@/data/badgeRepo";
import { checkBadge } from "@/services/checkBadge";

export const runtime = "nodejs";

const MAX_BYTES = 2 * 1024 * 1024;

function threshold(v: FormDataEntryValue | null, fallback: number) {
  const n = Number(v);
  return v !== null && Number.isInteger(n) && n >= 0 && n <= 64 ? n : fallback;
}

function designThreshold(v: FormDataEntryValue | null, fallback: number) {
  const n = Number(v);
  return v !== null && n >= 0 && n <= 1 ? n : fallback;
}

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "Archivo demasiado grande" }, { status: 413 });

  const thresholds = {
    dhash: threshold(form.get("dhash"), config.thresholds.dhash),
    silhouette: threshold(form.get("sil"), config.thresholds.silhouette),
    design: designThreshold(form.get("design"), config.thresholds.design),
  };

  try {
    const { analysis: a, exact, similar } = await checkBadge(
      new PgBadgeRepository(),
      Buffer.from(await file.arrayBuffer()),
      thresholds,
    );
    return NextResponse.json({
      upload: {
        format: a.format,
        width: a.width,
        height: a.height,
        uniqueFrames: a.uniqueFrames,
        animated: a.animated,
        sizeNote: a.sizeNote,
      },
      thresholds,
      exact,
      similar,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `No se pudo leer la imagen: ${msg}` }, { status: 422 });
  }
}
