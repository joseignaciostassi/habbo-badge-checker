import { NextResponse } from "next/server";
import { thresholdTable } from "@/core/calibration";
import { CalibrationRepository, type Label } from "@/data/calibrationRepo";

export const runtime = "nodejs";

const LABELS = new Set<Label>(["similar", "different", "unsure"]);

/** Next pair to label, labeling progress and the current threshold estimates. */
export async function GET() {
  const repo = new CalibrationRepository();
  const [pair, strata, badgeCount] = await Promise.all([repo.next(), repo.strataStats(), repo.badgeCount()]);
  return NextResponse.json({ pair, strata, table: thresholdTable(strata, badgeCount) });
}

/** Body: { pairId, label } with label null to undo. */
export async function POST(req: Request) {
  const { pairId, label } = await req.json();
  if (!Number.isInteger(pairId) || !(label === null || LABELS.has(label))) {
    return NextResponse.json({ error: "Datos inválidos" }, { status: 400 });
  }
  await new CalibrationRepository().setLabel(pairId, label);
  return NextResponse.json({ ok: true });
}
