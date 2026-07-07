/**
 * AI 포스터 생성 API 연동 (프롬프트 가이드 v3).
 *
 * `generatePoster`가 서버리스 함수 `/api/generate-poster`(gpt-image-2 edits)를
 * 호출합니다. 텍스트(제목·부제·로렐)는 이미지 모델이 직접 렌더하므로 클라이언트
 * 오버레이는 없습니다. 네트워크/생성 실패 시에는 원본 사진으로 넘기지 않고
 * 호출자가 에러 UI를 보여주도록 실패를 그대로 throw합니다.
 */
import { MAX_PEOPLE } from '../config/posterOptions';
import type { AppState } from '../store/appState';

const POSTER_API_TIMEOUT_MS = 52000;

/**
 * 서버 파이프라인(gpt-image-2 edits)에 넘기는 요청.
 * 인물 사진 1장(images) + 선택값. 프롬프트는 서버에서 조립한다.
 */
export interface PosterGenerateRequest {
  images: string[]; // dataURL(base64) 1장
  genre: string;
  mood: string;
  lighting: string;
  composition: string;
  title: string;
  subtitle?: string;
}

export interface PosterGenerateResponse {
  imageUrl: string;
  source: 'openai';
  inputImages: number;
  model?: string;
}

/** 전역 상태 + 압축된 사진들로 생성 요청 객체를 조립. */
export function buildPromptRequest(
  images: string[],
  state: Pick<
    AppState,
    | 'selectedGenre'
    | 'selectedMood'
    | 'selectedLighting'
    | 'selectedComposition'
    | 'movieTitle'
    | 'movieSubtitle'
  >,
): PosterGenerateRequest {
  return {
    images: images.slice(0, MAX_PEOPLE),
    genre: state.selectedGenre,
    mood: state.selectedMood,
    lighting: state.selectedLighting,
    composition: state.selectedComposition,
    title: state.movieTitle,
    subtitle: state.movieSubtitle,
  };
}

/** File → dataURL(base64). */
export function fileToDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 사진을 축소 + JPEG 압축해 dataURL로 반환.
 *
 * 실기기 카메라 원본(예: 1920x1080 PNG)은 base64로 수 MB가 되어 Vercel 함수
 * 본문 한도(4.5MB)를 넘겨 API 호출이 거부됩니다. 긴 변 maxDim 이하로 줄이고
 * JPEG로 압축하면 보통 수백 KB로 떨어져 안정적으로 전송됩니다. 사진을 여러 장
 * 보내므로(최대 4장) 합산 한도도 고려해 기본 품질을 적당히 유지합니다.
 */
export function compressImage(
  file: File | Blob,
  maxDim = 1024,
  quality = 0.82,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('canvas 2d context unavailable'));
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image load failed'));
    };
    img.src = url;
  });
}

/**
 * 포스터 생성.
 * 1) 서버리스 함수(/api/generate-poster)로 OpenAI 이미지 생성 시도(텍스트 포함).
 * 2) 실패 시 fallback 없이 throw해서 원본 사진이 전시/저장되지 않게 한다.
 */
export async function generatePoster(
  req: PosterGenerateRequest,
): Promise<PosterGenerateResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), POSTER_API_TIMEOUT_MS);
  try {
    const res = await fetch('/api/generate-poster', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        images: req.images,
        genre: req.genre,
        mood: req.mood,
        lighting: req.lighting,
        composition: req.composition,
        title: req.title,
        subtitle: req.subtitle,
      }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = data?.detail ?? data?.error ?? `api status ${res.status}`;
      throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
    }

    if (!data?.imageUrl) {
      throw new Error('api returned no image');
    }

    return {
      imageUrl: data.imageUrl,
      source: 'openai',
      inputImages: data.inputImages ?? req.images.length,
      model: data.model,
    };
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError'
      ? 'api timeout'
      : String((err as Error)?.message ?? err);
    console.warn('[generatePoster] api failed', reason);
    throw new Error(reason);
  } finally {
    window.clearTimeout(timeout);
  }
}
