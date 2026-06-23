/**
 * AI 포스터 생성 API 연동 (프롬프트 가이드 v3).
 *
 * `generatePoster`가 서버리스 함수 `/api/generate-poster`(gpt-image-2 edits)를
 * 호출합니다. 텍스트(제목·부제·로렐)는 이미지 모델이 직접 렌더하므로 클라이언트
 * 오버레이는 없습니다. 네트워크/생성 실패 시에는 사진+제목을 합성한 placeholder
 * 포스터(`generatePlaceholderPoster`)로 폴백합니다.
 */
import { COLORS } from '../config/appConfig';
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
  source: 'openai' | 'placeholder';
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 포스터 생성.
 * 1) 서버리스 함수(/api/generate-poster)로 OpenAI 이미지 생성 시도(텍스트 포함).
 * 2) 키 미설정/실패 시 로컬 canvas 합성 placeholder로 폴백.
 */
export async function generatePoster(
  req: PosterGenerateRequest,
): Promise<PosterGenerateResponse> {
  let fallbackReason = 'api unavailable';
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
    if (res.ok) {
      const data = (await res.json()) as Partial<PosterGenerateResponse>;
      if (data?.imageUrl) {
        return {
          imageUrl: data.imageUrl,
          source: data.source ?? 'openai',
          inputImages: data.inputImages ?? req.images.length,
        };
      }
      fallbackReason = 'api returned no image';
    } else {
      const data = await res.json().catch(() => null);
      fallbackReason = data?.detail || data?.error || `api status ${res.status}`;
      console.warn('[generatePoster] api failed', res.status, fallbackReason);
    }
  } catch (err) {
    fallbackReason = (err as Error)?.name === 'AbortError'
      ? 'api timeout'
      : String((err as Error)?.message ?? err);
    console.warn('[generatePoster] api unreachable', err);
  } finally {
    window.clearTimeout(timeout);
  }

  console.warn('[generatePoster] using local fallback poster', fallbackReason);
  return generatePlaceholderPoster(req);
}

/** 로컬 합성 placeholder(실제 API 실패 시 폴백). */
async function generatePlaceholderPoster(
  req: PosterGenerateRequest,
): Promise<PosterGenerateResponse> {
  // placeholder 합성: 첫 인물 사진을 2:3 포스터에 담고 제목/장르/로렐 타이포 오버레이.
  const W = 720;
  const H = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // 배경
  ctx.fillStyle = '#0c0e14';
  ctx.fillRect(0, 0, W, H);

  // 인물 사진 cover 배치 (상단 70%)
  try {
    const first = req.images[0];
    if (first) {
      const img = await loadImage(first);
      const areaH = H * 0.72;
      const scale = Math.max(W / img.width, areaH / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (W - dw) / 2, 0, dw, dh);

      // 하단 그라데이션으로 타이포 영역 확보
      const grad = ctx.createLinearGradient(0, areaH - 200, 0, H);
      grad.addColorStop(0, 'rgba(12,14,20,0)');
      grad.addColorStop(0.55, 'rgba(12,14,20,0.85)');
      grad.addColorStop(1, 'rgba(12,14,20,1)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, areaH - 200, W, H - (areaH - 200));
    }
  } catch {
    // 이미지 로드 실패 시 단색 유지.
  }

  // 장르 라벨
  ctx.textAlign = 'center';
  ctx.fillStyle = COLORS.bifanBlue;
  ctx.font = '700 30px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  if (req.genre) ctx.fillText(req.genre, W / 2, H - 250);

  // 영화 제목
  const title = (req.title || '무제').trim();
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 68px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
  wrapText(ctx, title, W / 2, H - 170, W - 80, 74);

  const subtitle = (req.subtitle || '').trim();
  if (subtitle) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '700 24px -apple-system, "Noto Sans KR", sans-serif';
    ctx.fillText(subtitle, W / 2, H - 110);
  }

  // 푸터 로렐
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 22px -apple-system, "Noto Sans KR", sans-serif';
  ctx.fillText('제30회 부천국제판타스틱영화제', W / 2, H - 76);
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '500 20px -apple-system, "Noto Sans KR", sans-serif';
  ctx.fillText('2026 여름 대개봉', W / 2, H - 42);

  // 합성 지연 시뮬레이션(실제 API 대기감)
  await new Promise((r) => setTimeout(r, 1200));

  return {
    imageUrl: canvas.toDataURL('image/png'),
    source: 'placeholder',
    inputImages: req.images.length,
  };
}

/** 캔버스 텍스트 줄바꿈(최대 2줄). */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
): void {
  const chars = [...text];
  const lines: string[] = [];
  let line = '';
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2);
  const startY = y - (shown.length - 1) * lineHeight;
  shown.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
