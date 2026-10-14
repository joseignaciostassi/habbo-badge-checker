import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config";
import type { ImageStore, StoredImage } from "./imageStore";

const EXTENSIONS = new Set([".gif", ".png"]);

/** Reads badges straight from a local folder. Never writes to it. */
export class LocalFsStore implements ImageStore {
  constructor(private readonly dir: string) {}

  async list(): Promise<StoredImage[]> {
    const entries = await readdir(this.dir, { withFileTypes: true });
    const files = entries.filter((e) => e.isFile() && EXTENSIONS.has(path.extname(e.name).toLowerCase()));
    return Promise.all(
      files.map(async (e) => {
        const s = await stat(path.join(this.dir, e.name));
        return { name: e.name, size: s.size, mtime: s.mtime };
      }),
    );
  }

  read(name: string): Promise<Buffer> {
    if (name !== path.basename(name)) throw new Error(`Invalid badge name: ${name}`);
    return readFile(path.join(this.dir, name));
  }
}

export function getImageStore(): ImageStore {
  return new LocalFsStore(config.badgesDir);
}
