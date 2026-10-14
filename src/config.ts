function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

export const config = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  get badgesDir() {
    return required("BADGES_DIR");
  },
  thresholds: {
    /** Max Hamming distances (0-64): coarse prefilter. */
    dhash: Number(process.env.SIM_DHASH_MAX ?? 20),
    silhouette: Number(process.env.SIM_SILHOUETTE_MAX ?? 10),
    /** Min design similarity (edge map IoU, 0-1) for the web check: the actual verification. */
    design: Number(process.env.SIM_DESIGN_MIN ?? 0.8),
  },
  /**
   * Full-base scan: same prefilter, stricter design threshold, since false pairs pile up
   * across 27k badges (calibrated: ~99% precision at 0.85 vs ~92% at 0.80).
   */
  get scanThresholds(): Thresholds {
    return { ...this.thresholds, design: Number(process.env.SIM_SCAN_DESIGN_MIN ?? 0.85) };
  },
};

export type Thresholds = typeof config.thresholds;
