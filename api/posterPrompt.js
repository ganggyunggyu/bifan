const POSTER_GENRES = [
  {
    label: '액션',
    prompt: 'action, smoke & debris, city',
    expression: 'fierce determined',
    titles: [
      { ko: '최후의 작전', en: 'THE LAST OPERATION' },
      { ko: '블랙 타깃', en: 'BLACK TARGET' },
      { ko: '멸살', en: 'ANNIHILATION' },
      { ko: '라스트 미션', en: 'LAST MISSION' },
      { ko: '분노의 추적', en: 'FURY CHASE' },
    ],
  },
  {
    label: 'SF',
    prompt: 'sci-fi, neon future city',
    expression: 'calm resolute',
    titles: [
      { ko: '2077: 마지막 신호', en: 'THE FINAL SIGNAL' },
      { ko: '에코 프로토콜', en: 'ECHO PROTOCOL' },
      { ko: '은하의 끝', en: 'EDGE OF GALAXY' },
      { ko: '싱귤래리티', en: 'SINGULARITY' },
      { ko: '네온 디바이드', en: 'NEON DIVIDE' },
    ],
  },
  {
    label: '로맨스',
    prompt: 'romance, soft dreamy, blossoms',
    expression: 'warm tender',
    titles: [
      { ko: '그 해, 우리의 봄', en: 'OUR SPRING' },
      { ko: '너의 계절', en: 'YOUR SEASON' },
      { ko: '마지막 편지', en: 'THE LAST LETTER' },
      { ko: '다시, 봄', en: 'SPRING AGAIN' },
      { ko: '오월의 밤', en: 'NIGHT IN MAY' },
    ],
  },
  {
    label: '공포',
    prompt: 'horror, fog, dark',
    expression: 'fearful uneasy',
    titles: [
      { ko: '새벽 세 시', en: '3 A.M.' },
      { ko: '검은 방', en: 'THE DARK ROOM' },
      { ko: '속삭임', en: 'WHISPERS' },
      { ko: '문 뒤에', en: 'BEHIND THE DOOR' },
      { ko: '저주받은 밤', en: 'CURSED NIGHT' },
    ],
  },
  {
    label: '코미디',
    prompt: 'comedy, bright playful',
    expression: 'playful grin',
    titles: [
      { ko: '대환장 패밀리', en: 'CRAZY FAMILY' },
      { ko: '오늘도 폭망', en: 'ANOTHER BAD DAY' },
      { ko: '웃픈 인생', en: 'LAUGH OR CRY' },
      { ko: '사고뭉치들', en: 'THE TROUBLEMAKERS' },
      { ko: '행복은 셀프', en: 'HAPPINESS DIY' },
    ],
  },
  {
    label: '느와르',
    prompt: 'noir, rainy neon street',
    expression: 'cold hard-boiled',
    titles: [
      { ko: '검은 도시', en: 'BLACK CITY' },
      { ko: '배신의 밤', en: 'NIGHT OF BETRAYAL' },
      { ko: '마지막 거래', en: 'THE LAST DEAL' },
      { ko: '회색 지대', en: 'GRAY ZONE' },
      { ko: '피의 계약', en: 'BLOOD PACT' },
    ],
  },
  {
    label: '판타지',
    prompt: 'fantasy, mythic, magic glow',
    expression: 'noble gaze',
    titles: [
      { ko: '천년의 검', en: 'SWORD OF MILLENNIUM' },
      { ko: '잊혀진 왕국', en: 'THE LOST KINGDOM' },
      { ko: '용의 후예', en: 'HEIR OF DRAGONS' },
      { ko: '마법의 숲', en: 'ENCHANTED FOREST' },
      { ko: '별의 예언', en: 'STARBORN PROPHECY' },
    ],
  },
  {
    label: '재난',
    prompt: 'disaster, collapsing city, dust',
    expression: 'desperate',
    titles: [
      { ko: '붕괴', en: 'COLLAPSE' },
      { ko: '최후의 날', en: 'THE LAST DAY' },
      { ko: '탈출', en: 'ESCAPE' },
      { ko: '대지진', en: 'AFTERSHOCK' },
      { ko: '생존자들', en: 'THE SURVIVORS' },
    ],
  },
];

const POSTER_MOODS = [
  { label: '웅장', prompt: 'epic' },
  { label: '긴장', prompt: 'tense' },
  { label: '감성', prompt: 'emotional' },
  { label: '어두움', prompt: 'dark moody' },
  { label: '유쾌', prompt: 'upbeat' },
  { label: '미스터리', prompt: 'mysterious' },
  { label: '비장', prompt: 'heroic solemn' },
  { label: '몽환', prompt: 'dreamy surreal' },
];

const POSTER_LIGHTING = [
  { label: '림라이트', prompt: 'rim light' },
  { label: '골든아워', prompt: 'golden hour' },
  { label: '네온', prompt: 'neon glow' },
  { label: '하이키', prompt: 'high-key bright' },
  { label: '로우키', prompt: 'low-key shadow' },
  { label: '화염', prompt: 'fiery backlight' },
  { label: '블루아워', prompt: 'cold blue hour' },
  { label: '스포트', prompt: 'dramatic spotlight' },
];

const POSTER_COMPOSITIONS = [
  { label: '클로즈업', prompt: 'close-up' },
  { label: '전신', prompt: 'full-body hero' },
  { label: '로우앵글', prompt: 'low-angle' },
  { label: '몽타주', prompt: 'split montage' },
  { label: '실루엣', prompt: 'silhouette' },
  { label: '부감', prompt: 'overhead' },
  { label: '대칭', prompt: 'symmetrical center' },
  { label: '와이드', prompt: 'epic wide shot' },
];

function getOptionPrompt(options, label) {
  return options.find((item) => item.label === label)?.prompt ?? label;
}

export function buildPosterPrompt(input) {
  const genre = POSTER_GENRES.find((item) => item.label === input.genre) ?? POSTER_GENRES[0];
  const mood = getOptionPrompt(POSTER_MOODS, input.mood);
  const lighting = getOptionPrompt(POSTER_LIGHTING, input.lighting);
  const composition = getOptionPrompt(POSTER_COMPOSITIONS, input.composition);
  const title = (input.title || genre.titles[0]?.ko || '무제').trim();
  const subtitle = (input.subtitle || genre.titles[0]?.en || '').trim();
  const titleSegment = subtitle
    ? `Korean title "${title}" / "${subtitle}"`
    : `Korean title "${title}"`;

  return [
    'Vertical 2:3 Korean film festival poster',
    'Use the uploaded image only as a loose reference for framing, color, and wardrobe mood',
    'Create one fictional adult central character only',
    'Do not identify, copy, or preserve exact face or biometric likeness from the uploaded image',
    'No extra characters, background people, reflections, or duplicate faces',
    'Keep the fictional character centered and prominent',
    genre.prompt,
    mood,
    lighting,
    composition,
    `${genre.expression} mood`,
    titleSegment,
    'BIFAN laurel',
    'epic cinematic key art.',
  ].join(', ');
}

export function buildSafePosterPrompt(input) {
  const genre = POSTER_GENRES.find((item) => item.label === input.genre) ?? POSTER_GENRES[0];
  const mood = getOptionPrompt(POSTER_MOODS, input.mood);
  const lighting = getOptionPrompt(POSTER_LIGHTING, input.lighting);
  const composition = getOptionPrompt(POSTER_COMPOSITIONS, input.composition);
  const title = (input.title || genre.titles[0]?.ko || '무제').trim();
  const subtitle = (input.subtitle || genre.titles[0]?.en || '').trim();
  const titleSegment = subtitle
    ? `Korean title "${title}" / "${subtitle}"`
    : `Korean title "${title}"`;

  return [
    'Vertical 2:3 Korean film festival poster',
    'Use the uploaded image only as a loose color and composition reference',
    'One fictional adult main character in the poster, centered, no additional characters',
    'Do not reproduce the exact person, face, identity, or biometric likeness from the uploaded image',
    genre.prompt,
    mood,
    lighting,
    composition,
    `${genre.expression} mood`,
    titleSegment,
    'BIFAN laurel',
    'polished cinematic poster design.',
  ].join(', ');
}

export function buildStandalonePosterPrompt(input) {
  const genre = POSTER_GENRES.find((item) => item.label === input.genre) ?? POSTER_GENRES[0];
  const mood = getOptionPrompt(POSTER_MOODS, input.mood);
  const lighting = getOptionPrompt(POSTER_LIGHTING, input.lighting);
  const composition = getOptionPrompt(POSTER_COMPOSITIONS, input.composition);
  const title = (input.title || genre.titles[0]?.ko || '무제').trim();
  const subtitle = (input.subtitle || genre.titles[0]?.en || '').trim();
  const titleSegment = subtitle
    ? `Korean title "${title}" / "${subtitle}"`
    : `Korean title "${title}"`;

  return [
    'Vertical 2:3 Korean film festival poster',
    'One fictional adult central character only',
    'No real person likeness, no duplicate faces, no background people',
    'Centered cinematic key art composition',
    genre.prompt,
    mood,
    lighting,
    composition,
    `${genre.expression} mood`,
    titleSegment,
    'BIFAN laurel',
    'polished cinematic poster design.',
  ].join(', ');
}
