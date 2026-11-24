import type { KV } from '../../worker/src/index';

/** In-memory stand-in for a Cloudflare KV namespace (sorted listing, metadata). */
export function memoryKV(): KV & { data: Map<string, { value: string; metadata?: unknown }> } {
  const data = new Map<string, { value: string; metadata?: unknown }>();
  return {
    data,
    async get(key) {
      return data.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      data.set(key, { value, metadata: options?.metadata });
    },
    async delete(key) {
      data.delete(key);
    },
    async list<M>({ prefix }: { prefix: string }) {
      const keys = [...data.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((name) => ({ name, metadata: data.get(name)!.metadata as M }));
      return { keys, list_complete: true };
    },
  };
}
