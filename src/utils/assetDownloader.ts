/**
 * 다운로드/사전로딩 진행률 시뮬레이터.
 *
 * 실제 에셋(GLB/이미지) 용량이 확정되면 `simulate` 대신 fetch + ReadableStream
 * 기반 진행률(아래 `downloadWithProgress`)로 교체하면 됩니다.
 */

export type ProgressCallback = (loaded: number, total: number) => void;

/**
 * 지정한 시간 동안 0 → totalMB까지 부드럽게 진행되는 가짜 다운로드.
 * UI 검증 및 실제 API 연동 전 임시용.
 */
export function simulateDownload(
  totalMB: number,
  durationMs: number,
  onProgress: ProgressCallback,
): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      // easeOutCubic 으로 끝부분이 자연스럽게 감속.
      const eased = 1 - Math.pow(1 - t, 3);
      onProgress(+(eased * totalMB).toFixed(1), totalMB);
      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
}

/**
 * 실제 파일을 진행률과 함께 받는 구현 (TODO: 에셋 확정 후 사용).
 * Content-Length가 없으면 진행률은 추정 불가하여 total=0 으로 전달됩니다.
 */
export async function downloadWithProgress(
  url: string,
  onProgress: ProgressCallback,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`download failed: ${res.status} ${url}`);
  }
  const total = Number(res.headers.get('Content-Length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress(loaded, total);
    }
  } finally {
    // 스트림 중단(네트워크 끊김 등)에도 reader 락을 반드시 해제.
    reader.releaseLock();
  }
  return new Blob(chunks as BlobPart[]);
}
