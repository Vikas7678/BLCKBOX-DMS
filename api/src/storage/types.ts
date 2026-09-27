import { Readable } from "stream";

export interface StoredObject {
  storageKey: string;
  sizeBytes: number;
}

export interface StorageService {
  /** Prefer putFromFile for uploads so the payload is not held in RAM. */
  put(key: string, data: Buffer, mimeType: string): Promise<StoredObject>;
  /** Store from a path already on disk (move for local, stream then caller may delete for S3). */
  putFromFile(key: string, filePath: string, mimeType: string): Promise<StoredObject>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  ensureReady?(): Promise<void>;
}
