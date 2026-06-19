import { buildPosterPrompt } from '../src/config/posterOptions';

/**
 * Vercel 서버리스 함수 — AI 영화 포스터 생성 (프롬프트 가이드 v3).
 *
 * - 인물 사진 1~4장을 입력(gpt-image-1 edits)으로 사용해 출연 배우 컨셉의 포스터 생성
 *   (얼굴은 "natural, faithful resemblance"로 우회 — 합성/조작 필터 회피).
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
  const prompt = buildStylePrompt(genre, mood, lighting, composition, title, subtitle);

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'medium');
  form.append('n', '1');

  // 여러 장이면 image[] 배열로, 한 장이면 image 단일 필드로 전송.
  const multi = images.length > 1;
  for (let i = 0; i < images.length; i++) {
    const dataUrl = String(images[i]);
    const mimeMatch = /^data:(image\/[a-zA-Z+]+);base64,/.exec(dataUrl);
    const mime = mimeMatch ? mimeMatch[1] : 'image/png';
    const ext = mime.split('/')[1].replace('jpeg', 'jpg');
    const base64 = dataUrl.split(',')[1];
    if (!base64) return { error: 'invalid image data' };
    const buffer = Buffer.from(base64, 'base64');
    form.append(multi ? 'image[]' : 'image', new Blob([buffer], { type: mime }), `photo${i}.${ext}`);
  }

  let r: any;
  try {
    // 이미지 생성은 느리므로 함수 한도(60s) 직전(~50s)에 끊는다.
    r = await fetchWithTimeout(
      `${OPENAI}/images/edits`,
      { method: 'POST', headers: { Authorization: `Bearer ${apiKey}` }, body: form },
      50000,
    );
  } catch (err: any) {
    return { error: err?.name === 'AbortError' ? 'timeout' : String(err?.message ?? err) };
  }
  const data = await r.json();
  if (!r.ok) return { error: data?.error ?? data };
  return { b64: data?.data?.[0]?.b64_json };
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
    const photos: string[] = Array.isArray(images)
      ? images.filter(Boolean)
      : imageBase64
        ? [imageBase64]
        : [];
    if (!photos.length || !genre) {
      res.status(400).json({ error: 'images and style selections are required' });
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

    res.status(200).json({ imageUrl: `data:image/png;base64,${img.b64}` });
  } catch (err: any) {
    res.status(500).json({ error: 'server error', detail: String(err?.message ?? err) });
  }
}
