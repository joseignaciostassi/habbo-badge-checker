import { config } from "@/config";
import { Checker } from "./Checker";

export const dynamic = "force-dynamic";

export default function Home() {
  return <Checker defaults={config.thresholds} />;
}
