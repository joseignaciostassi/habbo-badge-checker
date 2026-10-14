export interface StoredImage {
  name: string;
  size: number;
  mtime: Date;
}

/** Read-only access to the badge image collection (local folder now, Supabase Storage later). */
export interface ImageStore {
  list(): Promise<StoredImage[]>;
  read(name: string): Promise<Buffer>;
}
