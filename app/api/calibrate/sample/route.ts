import { getSampleJob, startSample } from "@/services/calibrationSample";

export const runtime = "nodejs";

/** Starts "Generar más pares". Answers at once; poll GET /api/calibrate for `sampleJob`. */
export async function POST() {
  if (!startSample()) return Response.json({ error: "Ya se están generando pares." }, { status: 409 });
  return Response.json({ sampleJob: getSampleJob() }, { status: 202 });
}
