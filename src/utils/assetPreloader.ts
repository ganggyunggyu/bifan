import { downloadWithProgress } from './assetDownloader';

/**
 * 에셋 사전 다운로드 + 캐시.
 *
 * 와이파이가 느리면 영상(mp4)이 재생 중간에 끊기므로, 시작 화면에서 실제 에셋을
 * 전부 받아 Blob으로 캐시하고, 재생 시 네트워크 대신 메모리(blob URL)에서 읽습니다.
 * 진행률은 실제 바이트 기준(MB)으로 표시합니다.
 */
export const PRELOAD_ASSETS: string[] = [
  '/assets/video/module-a.mp4', // 핵심: 끊김 유발하는 큰 영상
  '/assets/guide/step1.png',
  '/assets/guide/step2.png',
  '/assets/guide/step3.png',
  '/assets/guide/step4.png',
];

// 원본 URL -> objectURL(blob)
const cache = new Map<string, string>();

/** 캐시된(다운로드된) blob URL이 있으면 반환, 없으면 원본 URL. */
export function cachedUrl(url: string): string {
  return cache.get(url) ?? url;
}

export function isPreloaded(): boolean {
  return cache.size > 0;
}

/** 전체 용량(bytes) — HEAD 요청으로 Content-Length 합산. */
export async function getTotalBytes(): Promise<number> {
  const sizes = await Promise.all(
    PRELOAD_ASSETS.map(async (u) => {
      try {
        const r = await fetch(u, { method: 'HEAD' });
        return Number(r.headers.get('Content-Length') || 0);
      } catch {
        return 0;
      }
    }),
  );
  return sizes.reduce((a, b) => a + b, 0);
}

/**
 * 모든 에셋을 진행률과 함께 다운로드하고 blob으로 캐시.
 * onProgress(loadedBytes, totalBytes) — 실제 바이트.
 */
export async function preloadAll(
  onProgress: (loadedBytes: number, totalBytes: number) => void,
  total?: number,
): Promise<void> {
  const totalBytes = total ?? (await getTotalBytes());
  let base = 0;
  for (const url of PRELOAD_ASSETS) {
    if (cache.has(url)) {
      onProgress(base, totalBytes);
      continue;
    }
    try {
      const blob = await downloadWithProgress(url, (l) =>
        onProgress(base + l, totalBytes),
      );
      cache.set(url, URL.createObjectURL(blob));
      base += blob.size;
      onProgress(base, totalBytes);
    } catch (err) {
      console.warn('[assetPreloader] failed:', url, err);
    }
  }
  // 완료 시 100%로 정렬.
  onProgress(totalBytes || base, totalBytes || base);
}
