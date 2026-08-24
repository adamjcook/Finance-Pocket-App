import type { SyncedState, SyncPayload } from '../model/types';

/**
 * QR frame codec: JSON -> deflate-raw -> 600-byte chunks -> text frames
 *   FP1:<txId>:<seq>:<total>:<crc32hex>:<base64url(chunk)>
 * Frames are order-independent; the crc32 is over the whole compressed blob.
 */

const FRAME_PREFIX = 'FP1';
const CHUNK_BYTES = 600;

// ---- bytes helpers ----

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(
    new Blob([bytes as BlobPart]).stream().pipeThrough(stream),
  ).arrayBuffer();
  return new Uint8Array(await out);
}

export function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new CompressionStream('deflate-raw'));
}

export function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThrough(bytes, new DecompressionStream('deflate-raw'));
}

export function toBase64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): string {
  let crc = 0xffffffff;
  for (const b of bytes) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// ---- payload <-> frames ----

export function buildPayload(state: SyncedState, deviceId: string): SyncPayload {
  return { v: 1, deviceId, sentAt: new Date().toISOString(), ...state };
}

export async function encodePayload(payload: SyncPayload): Promise<string[]> {
  const compressed = await deflate(new TextEncoder().encode(JSON.stringify(payload)));
  const crc = crc32(compressed);
  const txId = Array.from({ length: 4 }, () =>
    '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 36)],
  ).join('');
  const total = Math.max(1, Math.ceil(compressed.length / CHUNK_BYTES));
  const frames: string[] = [];
  for (let seq = 0; seq < total; seq++) {
    const chunk = compressed.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
    frames.push(`${FRAME_PREFIX}:${txId}:${seq}:${total}:${crc}:${toBase64url(chunk)}`);
  }
  return frames;
}

export interface ParsedFrame {
  txId: string;
  seq: number;
  total: number;
  crc: string;
  chunk: Uint8Array;
}

export function parseFrame(text: string): ParsedFrame | null {
  const parts = text.split(':');
  if (parts.length !== 6 || parts[0] !== FRAME_PREFIX) return null;
  const [, txId, seqS, totalS, crc, data] = parts;
  const seq = Number(seqS);
  const total = Number(totalS);
  if (!Number.isInteger(seq) || !Number.isInteger(total) || seq < 0 || total < 1 || seq >= total) {
    return null;
  }
  try {
    return { txId, seq, total, crc, chunk: fromBase64url(data) };
  } catch {
    return null;
  }
}

export async function decodePayloadBytes(compressed: Uint8Array): Promise<SyncPayload> {
  const json = new TextDecoder().decode(await inflate(compressed));
  const payload = JSON.parse(json) as SyncPayload;
  if (payload.v !== 1) {
    throw new Error(
      `This code came from an app version this phone doesn't understand (v${String(payload.v)}). Update both phones to the same version and try again.`,
    );
  }
  return payload;
}

/** Decode a complete set of frames (any order). Used by tests and file import. */
export async function decodeFrames(frames: string[]): Promise<SyncPayload> {
  const collector = new FrameCollector();
  for (const f of frames) collector.add(f);
  if (!collector.isComplete()) throw new Error('Incomplete frame set');
  return collector.result();
}

/**
 * Order-independent chunk collector. If a frame from a newer transmission
 * (different txId) arrives, the collector restarts on that transmission —
 * one phone transmits at a time, so the latest txId is the live one.
 */
export class FrameCollector {
  private txId: string | null = null;
  private total = 0;
  private crc = '';
  private chunks = new Map<number, Uint8Array>();

  /** Returns true when the frame advanced progress. */
  add(text: string): boolean {
    const frame = parseFrame(text);
    if (!frame) return false;
    if (this.txId !== frame.txId) {
      this.txId = frame.txId;
      this.total = frame.total;
      this.crc = frame.crc;
      this.chunks.clear();
    }
    if (frame.total !== this.total || frame.crc !== this.crc) return false;
    if (this.chunks.has(frame.seq)) return false;
    this.chunks.set(frame.seq, frame.chunk);
    return true;
  }

  received(): number {
    return this.chunks.size;
  }

  expected(): number {
    return this.total;
  }

  has(seq: number): boolean {
    return this.chunks.has(seq);
  }

  isComplete(): boolean {
    return this.txId !== null && this.chunks.size === this.total;
  }

  async result(): Promise<SyncPayload> {
    if (!this.isComplete()) throw new Error('Frame set incomplete');
    const parts: Uint8Array[] = [];
    let length = 0;
    for (let i = 0; i < this.total; i++) {
      const c = this.chunks.get(i)!;
      parts.push(c);
      length += c.length;
    }
    const blob = new Uint8Array(length);
    let offset = 0;
    for (const p of parts) {
      blob.set(p, offset);
      offset += p.length;
    }
    if (crc32(blob) !== this.crc) {
      throw new Error('Scanned data failed its integrity check — try scanning again.');
    }
    return decodePayloadBytes(blob);
  }
}
