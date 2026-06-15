/**
 * Vercel 서버리스 함수 — AI 영화 포스터 생성 (프롬프트 가이드 v2).
 *
 * - 인물 사진 1~4장을 입력(gpt-image-1 edits)으로 사용해 출연 배우 컨셉의 포스터 생성
 *   (얼굴은 "natural, faithful resemblance"로 우회 — 합성/조작 필터 회피).
 * - 제목·부제·로렐 등 텍스트는 이미지 모델이 직접 렌더(앱 오버레이 제거).
 *
 * 입력: { images: string[], genre, mood, lighting, composition, title }
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

// ── BIFAN 프롬프트 가이드 v2 (콤팩트 / 필터 우회판) ──────────────────────
// 구조: [베이스] + [인물수] + [장르 world + 표정] + [분위기] + [조명] + [구도]
//       + [타이포] + [마감]

const BASE_SINGLE =
  'A vertical 2:3 cinematic blockbuster movie poster starring the person from the ' +
  "attached photo as the film's lead, drawn with a natural, faithful resemblance to the reference.";
const BASE_MULTI =
  'A vertical 2:3 cinematic blockbuster movie poster starring the people from the ' +
  "attached photos as the film's leads, drawn with a natural, faithful resemblance to the references.";

const PEOPLE_PROMPTS: Record<number, string> = {
  1: 'The lead stands alone at the center of the frame, larger-than-life.',
  2: 'Two leads share the frame in layered depth with dynamic tension.',
  3: 'Three leads in a triangular ensemble, center figure largest.',
  4: 'Four leads in a layered lineup, two central figures largest, every face visible.',
};

// 장르: world(세계관) + expr(표정).
const GENRE_PROMPTS: Record<string, { world: string; expr: string }> = {
  액션: {
    world:
      'High-octane action world: flying debris, sparks, smoke, city skyline, tactical wardrobe.',
    expr: 'a fierce, determined gaze with a set jaw',
  },
  SF: {
    world:
      'Epic sci-fi world: futuristic city or deep space, holograms, sleek tech suit, glowing energy.',
    expr: 'a calm, resolute, visionary stare',
  },
  로맨스: {
    world:
      'Romantic drama: dreamy soft atmosphere, blossoms or night bokeh, warm tender moment.',
    expr: 'a soft, affectionate smile with warm eyes',
  },
  공포: {
    world:
      'Suspenseful chiller: fog, deep shadows, abandoned setting, muted palette with one accent color.',
    expr: 'wide, uneasy eyes frozen in dread',
  },
  코미디: {
    world:
      'Comedy: bright saturated colors, playful poses, fun chaotic props, energetic layout.',
    expr: 'a big playful grin with a raised eyebrow',
  },
  '느와르/범죄': {
    world: 'Stylish noir: rain-soaked streets, trench coat, smoky haze, neon reflections.',
    expr: 'a cold, unreadable hard-boiled stare',
  },
  판타지: {
    world:
      'Epic fantasy: mythic landscape, ornate costume, glowing magical particles, sweeping scale.',
    expr: 'a noble, awe-touched expression gazing into the distance',
  },
  재난: {
    world:
      'Disaster epic: collapsing city or giant wave backdrop, dust in the air, dramatic scale contrast.',
    expr: 'an expression of desperate, strained resolve',
  },
};

const MOOD_PROMPTS: Record<string, string> = {
  웅장한: 'Grand, sweeping, heroic mood.',
  긴장감: 'Tense, suspenseful, coiled-energy mood.',
  감성적인: 'Heartfelt, nostalgic, lyrical mood.',
  어두운: 'Moody, brooding, shadow-heavy tone.',
  유쾌한: 'Upbeat, vibrant, feel-good mood.',
  미스터리: 'Enigmatic, intriguing, secretive mood.',
};

const LIGHTING_PROMPTS: Record<string, string> = {
  '역광 림라이트': 'Strong rim backlight tracing glowing edges, high contrast.',
  골든아워: 'Warm golden-hour glow, long soft shadows.',
  네온: 'Cyan-and-magenta neon glow, reflective wet surfaces.',
  하이키: 'Bright, clean, evenly lit high-key look.',
  로우키: 'Low-key chiaroscuro: deep blacks, one dramatic light source.',
  '화염 백라이트': 'Orange fire-glow backlight, floating embers, heat haze.',
};

const COMPOSITION_PROMPTS: Record<string, string> = {
  클로즈업: 'Dramatic close-up filling the upper frame, eyes in focus.',
  '전신 히어로샷': 'Full-body hero stance, low horizon, world sprawling behind.',
  로우앵글: 'Low-angle view looking up, towering figure against dramatic sky.',
  '분할 몽타주':
    'Classic one-sheet split montage: large portrait above fading into a panoramic scene below.',
  실루엣: 'Bold silhouette against a luminous backdrop, rim-lit edges.',
  '부감(오버헤드)': 'Tilted overhead perspective, dynamic diagonal energy.',
};

const FINISHING =
  'Premium theatrical key art: film grain, rich cinematic color grade, layered depth, no watermark.';

function expressionSentence(expr: string): string {
  return (
    `The lead wears ${expr}, an expression fitting the film's tone — ` +
    'while their natural facial features stay true to the reference photo.'
  );
}

function typographySentence(title: string): string {
  const safe = (title || '무제').trim();
  return (
    `Korean title "${safe}" in bold cinematic typography at the bottom, ` +
    'with a fitting short English subtitle beneath, a small billing block, ' +
    'the line "2026 여름 대개봉", and festival laurels "제30회 부천국제판타스틱영화제". ' +
    'Korean text accurate and legible.'
  );
}

function buildStylePrompt(
  people: number,
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
): string {
  const n = Math.min(Math.max(people, 1), 4);
  const g = GENRE_PROMPTS[genre];
  return [
    n > 1 ? BASE_MULTI : BASE_SINGLE,
    PEOPLE_PROMPTS[n] ?? PEOPLE_PROMPTS[1],
    g?.world ?? genre,
    g ? expressionSentence(g.expr) : '',
    MOOD_PROMPTS[mood] ?? mood,
    LIGHTING_PROMPTS[lighting] ?? lighting,
    COMPOSITION_PROMPTS[composition] ?? composition,
    typographySentence(title),
    FINISHING,
  ]
    .filter(Boolean)
    .join(' ');
}

async function generateImage(
  apiKey: string,
  images: string[],
  people: number,
  genre: string,
  mood: string,
  lighting: string,
  composition: string,
  title: string,
): Promise<{ b64?: string; error?: any }> {
  const prompt = buildStylePrompt(people, genre, mood, lighting, composition, title);

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
    const { images, imageBase64, genre, mood, lighting, composition, title } = body ?? {};
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
    const people = Math.min(Math.max(photos.length, 1), 4);

    const img = await generateImage(
      apiKey,
      photos,
      people,
      genre,
      mood,
      lighting,
      composition,
      title,
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
