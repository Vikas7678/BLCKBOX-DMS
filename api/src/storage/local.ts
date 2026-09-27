import fs from "fs/promises";
import { createReadStream, existsSync } from "fs";
import path from "path";
import { Readable } from "stream";
import { StoredObject, StorageService } from "./types";

export class LocalDiskStorage implements StorageService {
  constructor(private readonly rootDir: string) {}

  async ensureReady(): Promise<void> {
    await fs.mkdir(this.rootDir, { recursive: true });
  }

  private resolveSafe(key: string): string {
    const resolved = path.resolve(this.rootDir, key);
    if (!resolved.startsWith(this.rootDir)) {
      throw new Error("Invalid storage key");
    }
    return resolved;
  }

  async put(key: string, data: Buffer, _mimeType: string): Promise<StoredObject> {
    const fullPath = this.resolveSafe(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, data);
    return { storageKey: key, sizeBytes: data.length };
  }

  async putFromFile(key: string, filePath: string, _mimeType: string): Promise<StoredObject> {
    const fullPath = this.resolveSafe(key);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    const stat = await fs.stat(filePath);
    try {
      await fs.rename(filePath, fullPath);
    } catch {
      // Cross-device rename fails — copy then remove source.
      await fs.copyFile(filePath, fullPath);
      await fs.unlink(filePath).catch(() => undefined);
    }
    return { storageKey: key, sizeBytes: stat.size };
  }

  async getStream(key: string): Promise<Readable> {
    const fullPath = this.resolveSafe(key);
    if (!existsSync(fullPath)) {
      throw Object.assign(new Error("File not found in storage"), { status: 404 });
    }
    return createReadStream(fullPath);
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveSafe(key);
    if (existsSync(fullPath)) {
      await fs.unlink(fullPath);
    }
  }
}
