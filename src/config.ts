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
    dhash: Number(process.env.SIM_DHASH_MAX ?? 10),
    silhouette: Number(process.env.SIM_SILHOUETTE_MAX ?? 8),
  },
};

export type Thresholds = typeof config.thresholds;
