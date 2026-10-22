import { CalibrationRepository } from "@/data/calibrationRepo";
import { ensureDatabase } from "@/data/setup";
import { Labeler } from "./Labeler";

export const dynamic = "force-dynamic";

export default async function CalibratePage() {
  // First run (no database yet): SyncBanner shows the setup dialog instead.
  if ((await ensureDatabase({ create: false })).state !== "ready") return null;
  if (!(await new CalibrationRepository().hasSample())) {
    return (
      <p className="empty">
        Todavía no hay una muestra de pares. Corré <code>npm run calibrate -- --sample</code>.
      </p>
    );
  }
  return <Labeler />;
}
