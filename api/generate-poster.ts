import {
  buildPosterPrompt,
  buildSafePosterPrompt,
  buildStandalonePosterPrompt,
} from './posterPrompt.js';

/**
 * Vercel 서버리스 함수 — AI 영화 포스터 생성 (프롬프트 가이드 v3).
 *
 * - 인물 사진 1장을 multipart 파일 입력(gpt-image-2 edits)으로 사용해 단독 주연 컨셉의 포스터 생성.
 *   안전필터를 피하기 위해 얼굴 동일성 복제 표현 대신 포스터용 스타일 레퍼런스로 처리.
 * - 제목·부제·로렐 등 텍스트는 이미지 모델이 직접 렌더(앱 오버레이 제거).
 *
 * 입력: { images: string[], genre, mood, lighting, composition, title, subtitle }
 * 출력: { imageUrl }
 * 필요 환경변수: OPENAI_API_KEY
 */
declare const process: { env: Record<string, string | undefined> };
declare const Buffer: { from(data: string, encoding: string): any };

export const config = { maxDuration: 60 };

const OPENAI = 'https://api.openai.com/v1';
const IMAGE_MODEL = process.env.POSTER_IMAGE_MODEL ?? 'gpt-image-2';
const FUNCTION_BUDGET_MS = 54000;
const OUTPUT_FORMAT = 'jpeg';
const OUTPUT_MIME = 'image/jpeg';
const OUTPUT_COMPRESSION = '82';
const IMAGE_SIZE = '1024x1536';

function supportsInputFidelity(model: string): boolean {
  return (
    !model.includes('mini') &&
    (model.startsWith('gpt-image-1') ||
      model.startsWith('gpt-image-2') ||
      model === 'chatgpt-image-latest')
  );
}

/**
 * OpenAI 호출에 타임아웃을 건다. Vercel 함수 한도(maxDuration 60s)에 닿아
 * 플랫폼이 비정형 504로 죽이기 전에 AbortController로 깔끔히 끊고,
 * 클라이언트가 폴백 포스터로 결정적으로 전환할 수 있게 한다.
 */
async function fetchWithTimeout(url: string, init: any, ms: number): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function buildStylePrompt(
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
  subtitle: string,
): string {
  return buildPosterPrompt({ genre, mood, lighting, composition, title, subtitle });
}

function buildSafeStylePrompt(
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
  subtitle: string,
): string {
  return buildSafePosterPrompt({ genre, mood, lighting, composition, title, subtitle });
}

function buildStandaloneStylePrompt(
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
  subtitle: string,
): string {
  return buildStandalonePosterPrompt({ genre, mood, lighting, composition, title, subtitle });
}

function isModerationBlocked(error: any): boolean {
  const code = String(error?.code ?? '').toLowerCase();
  const type = String(error?.type ?? '').toLowerCase();
  const message = String(error?.message ?? error ?? '').toLowerCase();
  return (
    code.includes('moderation') ||
    type.includes('moderation') ||
    message.includes('safety system') ||
    message.includes('moderation')
  );
}

function dataUrlToImageBlob(
  dataUrl: string,
  index: number,
): { blob: Blob; filename: string } | { error: string } {
  const match = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl);
  if (!match) return { error: 'invalid image mime' };

  const mime = match[1].toLowerCase().replace('image/jpg', 'image/jpeg');
  const base64 = match[2];
  if (!base64) return { error: 'invalid image data' };

  const extension = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  return {
    blob: new Blob([Buffer.from(base64, 'base64')], { type: mime }),
    filename: `poster-input-${index + 1}.${extension}`,
  };
}

async function generateImage(
  apiKey: string,
  images: string[],
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
  subtitle: string,
): Promise<{ b64?: string; error?: any }> {
  const startedAt = Date.now();
  const primaryPrompt = buildStylePrompt(genre, mood, lighting, composition, title, subtitle);
  const safePrompt = buildSafeStylePrompt(genre, mood, lighting, composition, title, subtitle);
  const standalonePrompt = buildStandaloneStylePrompt(
    genre,
    mood,
    lighting,
    composition,
    title,
    subtitle,
  );

  const imageFiles: Array<{ blob: Blob; filename: string }> = [];
  for (let i = 0; i < images.length; i++) {
    const dataUrl = String(images[i] ?? '');
    const parsed = dataUrlToImageBlob(dataUrl, i);
    if ('error' in parsed) return { error: parsed.error };
    imageFiles.push(parsed);
  }

  const runEditRequest = async (
    prompt: string,
    timeoutMs: number,
  ): Promise<{ b64?: string; error?: any }> => {
    let r: any;
    try {
      const body = new FormData();
      body.append('model', IMAGE_MODEL);
      body.append('prompt', prompt);
      body.append('size', IMAGE_SIZE);
      body.append('quality', 'low');
      body.append('n', '1');
      body.append('output_format', OUTPUT_FORMAT);
      body.append('output_compression', OUTPUT_COMPRESSION);
      if (supportsInputFidelity(IMAGE_MODEL)) {
        body.append('input_fidelity', 'low');
      }
      imageFiles.forEach((file) => body.append('image', file.blob, file.filename));
      r = await fetchWithTimeout(
        `${OPENAI}/images/edits`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body,
        },
        timeoutMs,
      );
    } catch (err: any) {
      return { error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
    }
    const data = await r.json();
    if (!r.ok) return { error: data?.error ?? data };
    return { b64: data?.data?.[0]?.b64_json };
  };

  const runStandaloneRequest = async (
    prompt: string,
    timeoutMs: number,
  ): Promise<{ b64?: string; error?: any }> => {
    let r: any;
    try {
      r = await fetchWithTimeout(
        `${OPENAI}/images/generations`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: IMAGE_MODEL,
            prompt,
            size: IMAGE_SIZE,
            quality: 'low',
            n: 1,
            output_format: OUTPUT_FORMAT,
            output_compression: OUTPUT_COMPRESSION,
          }),
        },
        timeoutMs,
      );
    } catch (err: any) {
      return { error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
    }
    const data = await r.json();
    if (!r.ok) return { error: data?.error ?? data };
    return { b64: data?.data?.[0]?.b64_json };
  };

  const remainingBudget = (): number =>
    Math.max(5000, FUNCTION_BUDGET_MS - (Date.now() - startedAt));
  const primaryTimeout = IMAGE_MODEL.startsWith('gpt-image-2') ? 34000 : 28000;

  // 이미지 생성은 느리므로 함수 한도(60s)에 닿기 전 끊는다.
  const primary = await runEditRequest(primaryPrompt, Math.min(primaryTimeout, remainingBudget()));
  if (primary.b64) return primary;

  const shouldSkipImageRetry = isModerationBlocked(primary.error) || primary.error === 'timeout';
  const safe = shouldSkipImageRetry
    ? await runStandaloneRequest(standalonePrompt, remainingBudget())
    : await runEditRequest(safePrompt, Math.min(18000, remainingBudget()));
  if (safe.b64) return safe;

  if (!isModerationBlocked(primary.error)) {
    const standalone = await runStandaloneRequest(standalonePrompt, remainingBudget());
    if (standalone.b64) return standalone;
    return { error: { primary: primary.error, safe: safe.error, standalone: standalone.error } };
  }

  return { error: { primary: primary.error, fallback: safe.error } };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(501).json({ error: 'OPENAI_API_KEY not configured' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { images, imageBase64, genre, mood, lighting, composition, title, subtitle } = body ?? {};
    // images 배열 우선, 구버전 단일 필드(imageBase64)도 허용.
    const rawPhotos: string[] = Array.isArray(images)
      ? images.filter(Boolean)
      : imageBase64
        ? [imageBase64]
        : [];
    const photos = rawPhotos.slice(0, 1);
    if (!photos.length || !genre) {
      res.status(400).json({ error: 'one image and style selections are required' });
      return;
    }

    const img = await generateImage(
      apiKey,
      photos,
      genre,
      mood,
      lighting,
      composition,
      title,
      subtitle,
    );
    if (img.error || !img.b64) {
      res.status(502).json({ error: 'image gen error', detail: img.error ?? 'no image' });
      return;
    }

    res.status(200).json({
      imageUrl: `data:${OUTPUT_MIME};base64,${img.b64}`,
      source: 'openai',
      inputImages: photos.length,
      model: IMAGE_MODEL,
    });
  } catch (err: any) {
    res.status(500).json({ error: 'server error', detail: String(err?.message ?? err) });
  }
}
