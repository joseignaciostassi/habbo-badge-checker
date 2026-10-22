export interface StoredImage {
  name: string;
  size: number;
  mtime: Date;
}

/** Read-only access to the badge image collection. */
export interface ImageStore {
  list(): Promise<StoredImage[]>;
  read(name: string): Promise<Buffer>;
}
