import sharp from "sharp";
import { sniffFormat, uploadProblem } from "../core/uploadRules";

/**
 * Full check of a badge to compare: .gif/.png name, at most 200 KB, GIF or PNG content and at
 * most 50x50 (frame size, for animated GIFs). Returns the problem in Spanish, or null.
 */
export async function validateUpload(name: string, data: Buffer): Promise<string | null> {
  const base = { name, size: data.length, format: sniffFormat(data) };
  const early = uploadProblem(base);
  if (early) return early;
  const meta = await sharp(data, { animated: true }).metadata().catch(() => null);
  if (!meta?.width || !meta.height) return "No se pudo leer la imagen.";
  return uploadProblem({ ...base, width: meta.width, height: meta.pageHeight ?? meta.height });
}
