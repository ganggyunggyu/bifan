import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadWithProgress } from './assetDownloader';

const originalFetch = globalThis.fetch;

function responseWithBody(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Length': String(new Blob([body]).size),
    },
  });
}

describe('downloadWithProgress', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('downloads a streamed response and reports loaded bytes', async () => {
    const progress = vi.fn();
    globalThis.fetch = vi.fn(async () => responseWithBody('abcde'));

    const blob = await downloadWithProgress('/asset.glb', progress);

    expect(await blob.text()).toBe('abcde');
    expect(progress).toHaveBeenLastCalledWith(5, 5);
  });

  it('falls back to res.blob when ReadableStream is unavailable', async () => {
    const progress = vi.fn();
    const blob = new Blob(['fallback']);
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      body: null,
      headers: new Headers({ 'Content-Length': String(blob.size) }),
      blob: async () => blob,
    } as Response));

    const result = await downloadWithProgress('/mobile-asset.glb', progress);

    expect(await result.text()).toBe('fallback');
    expect(progress).toHaveBeenLastCalledWith(blob.size, blob.size);
  });

  it('throws on failed responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 }));

    await expect(downloadWithProgress('/missing.glb', vi.fn())).rejects.toThrow(
      'download failed: 404 /missing.glb',
    );
  });
});
