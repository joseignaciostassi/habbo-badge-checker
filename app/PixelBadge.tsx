/** Badge enlarged by an integer factor with no smoothing, on a transparency checkerboard. */
export function PixelBadge({
  src,
  width,
  height,
  scale = 3,
  box = 156,
  title,
}: {
  src: string;
  width: number;
  height: number;
  scale?: number;
  box?: number;
  title?: string;
}) {
  // Fit oversized badges in the box with the largest integer scale that fits.
  const s = Math.max(1, Math.min(scale, Math.floor(box / Math.max(width, height))));
  return (
    <div className="pixel-box" style={{ width: box, height: box }} title={title}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} width={width * s} height={height * s} alt={title ?? ""} />
    </div>
  );
}
