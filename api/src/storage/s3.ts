import crypto from "crypto";
import fs from "fs";
import https from "https";
import http from "http";
import { URL } from "url";
import { Readable } from "stream";
import { StoredObject, StorageService } from "./types";

export type S3StorageConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
};

function sha256Hex(data: Buffer | string): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(d = new Date()): { amz: string; date: string } {
  const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amz: iso, date: iso.slice(0, 8) };
}

function encodeRfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeKey(key: string): string {
  return key
    .split("/")
    .map((part) => encodeRfc3986(part))
    .join("/");
}

function objectUrl(cfg: S3StorageConfig, key: string): URL {
  const region = cfg.region || "us-east-1";
  const forcePath = cfg.forcePathStyle ?? Boolean(cfg.endpoint);
  const base = cfg.endpoint
    ? new URL(cfg.endpoint)
    : new URL(`https://s3.${region}.amazonaws.com`);
  const host = forcePath ? base.host : `${cfg.bucket}.${base.host}`;
  const path =
    key === ""
      ? forcePath
        ? `/${cfg.bucket}`
        : "/"
      : forcePath
        ? `/${cfg.bucket}/${encodeKey(key)}`
        : `/${encodeKey(key)}`;
  return new URL(`${base.protocol}//${host}${path}`);
}

function sign(
  cfg: S3StorageConfig,
  method: string,
  key: string,
  opts: {
    body?: Buffer;
    payloadHash?: string;
    contentLength?: number;
    extraHeaders?: Record<string, string>;
  } = {},
): { method: string; url: URL; headers: Record<string, string>; body?: Buffer } {
  const region = cfg.region || "us-east-1";
  const url = objectUrl(cfg, key);
  const { amz, date } = amzDate();
  const payloadHash =
    opts.payloadHash ?? sha256Hex(opts.body ?? "");
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amz,
    ...(opts.extraHeaders ?? {}),
  };
  if (opts.body) {
    headers["content-length"] = String(opts.body.length);
  } else if (typeof opts.contentLength === "number") {
    headers["content-length"] = String(opts.contentLength);
  }

  const signedHeaderNames = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort();
  const headerMap = new Map(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim().replace(/\s+/g, " ")]),
  );
  const canonicalHeaders = signedHeaderNames.map((n) => `${n}:${headerMap.get(n)}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");
  const canonicalRequest = [
    method,
    url.pathname,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amz, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.authorization = [
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  return { method, url, headers, body: opts.body };
}

function request(signed: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body?: Buffer;
}): Promise<{ status: number; body: Buffer }> {
  const lib = signed.url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      signed.url,
      { method: signed.method, headers: signed.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    if (signed.body) req.write(signed.body);
    req.end();
  });
}

function requestWithStream(signed: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  bodyStream: Readable;
}): Promise<{ status: number; body: Buffer }> {
  const lib = signed.url.protocol === "http:" ? http : https;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      signed.url,
      { method: signed.method, headers: signed.headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    signed.bodyStream.on("error", (err) => {
      req.destroy(err);
      reject(err);
    });
    signed.bodyStream.pipe(req);
  });
}

export class S3Storage implements StorageService {
  constructor(private readonly cfg: S3StorageConfig) {}

  async ensureReady(): Promise<void> {
    const res = await request(sign(this.cfg, "HEAD", ""));
    if (res.status >= 400) {
      throw new Error(
        `S3 HeadBucket failed (${res.status}): ${res.body.toString("utf8") || "access denied"}`,
      );
    }
  }

  async put(key: string, data: Buffer, mimeType: string): Promise<StoredObject> {
    const res = await request(
      sign(this.cfg, "PUT", key, {
        body: data,
        extraHeaders: {
          "content-type": mimeType || "application/octet-stream",
        },
      }),
    );
    if (res.status >= 300) {
      throw new Error(`S3 put failed (${res.status}): ${res.body.toString("utf8")}`);
    }
    return { storageKey: key, sizeBytes: data.length };
  }

  async putFromFile(key: string, filePath: string, mimeType: string): Promise<StoredObject> {
    const stat = await fs.promises.stat(filePath);
    const signed = sign(this.cfg, "PUT", key, {
      // Stream body without buffering the whole file in RAM.
      payloadHash: "UNSIGNED-PAYLOAD",
      contentLength: stat.size,
      extraHeaders: {
        "content-type": mimeType || "application/octet-stream",
      },
    });
    const res = await requestWithStream({
      method: signed.method,
      url: signed.url,
      headers: signed.headers,
      bodyStream: fs.createReadStream(filePath),
    });
    if (res.status >= 300) {
      throw new Error(`S3 put failed (${res.status}): ${res.body.toString("utf8")}`);
    }
    return { storageKey: key, sizeBytes: stat.size };
  }

  async getStream(key: string): Promise<Readable> {
    const res = await request(sign(this.cfg, "GET", key));
    if (res.status === 404) {
      throw Object.assign(new Error("File not found in storage"), { status: 404 });
    }
    if (res.status >= 300) {
      throw new Error(`S3 get failed (${res.status}): ${res.body.toString("utf8")}`);
    }
    return Readable.from(res.body);
  }

  async delete(key: string): Promise<void> {
    const res = await request(sign(this.cfg, "DELETE", key));
    if (res.status >= 300 && res.status !== 404) {
      throw new Error(`S3 delete failed (${res.status}): ${res.body.toString("utf8")}`);
    }
  }
}
