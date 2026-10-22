/** Limits for a badge to check (web upload and `npm run compare`); the indexed folder is not limited. */
export const MAX_UPLOAD_BYTES = 200 * 1024;
export const MAX_UPLOAD_SIDE = 50;
const EXTENSIONS = [".gif", ".png"];

export type UploadFormat = "gif" | "png";

/** Format from the file's first bytes (the extension can lie: some .gif badges are PNGs). */
export function sniffFormat(head: Uint8Array): UploadFormat | null {
  const ascii = String.fromCharCode(...head.subarray(0, 6));
  if (ascii === "GIF87a" || ascii === "GIF89a") return "gif";
  if (head[0] === 0x89 && ascii.slice(1, 4) === "PNG") return "png";
  return null;
}

/**
 * Why a file cannot be checked, or null if it can. Pass what is known so far: name and size
 * first, then the sniffed format, then the frame dimensions.
 */
export function uploadProblem(f: {
  name: string;
  size: number;
  format?: UploadFormat | null;
  width?: number;
  height?: number;
}): string | null {
  const dot = f.name.lastIndexOf(".");
  const ext = dot >= 0 ? f.name.slice(dot).toLowerCase() : "";
  if (!EXTENSIONS.includes(ext)) return "Solo se aceptan archivos .gif o .png.";
  if (f.size > MAX_UPLOAD_BYTES) {
    return `El archivo pesa ${Math.ceil(f.size / 1024)} KB; el máximo es ${MAX_UPLOAD_BYTES / 1024} KB.`;
  }
  if (f.format === null) return "El archivo no es un GIF ni un PNG válido.";
  if (f.width !== undefined && f.height !== undefined && (f.width > MAX_UPLOAD_SIDE || f.height > MAX_UPLOAD_SIDE)) {
    return `La imagen mide ${f.width}x${f.height}; el máximo es ${MAX_UPLOAD_SIDE}x${MAX_UPLOAD_SIDE}.`;
  }
  return null;
}
