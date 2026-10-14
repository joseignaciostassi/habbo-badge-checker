import { CalibrationRepository } from "@/data/calibrationRepo";
import { Labeler } from "./Labeler";

export const dynamic = "force-dynamic";

export default async function CalibratePage() {
  if (!(await new CalibrationRepository().hasSample())) {
    return (
      <p className="empty">
        Todavía no hay una muestra de pares. Corré <code>npm run calibrate -- --sample</code>.
      </p>
    );
  }
  return <Labeler />;
}
