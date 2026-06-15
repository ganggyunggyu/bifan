/**
 * 포스터 스타일 선택지 (Screen 8) — BIFAN 프롬프트 가이드 v2.
 * 인물수(사진 장수에서 자동 도출) × 장르8 × 분위기6 × 조명6 × 구도6.
 *
 * NOTE: 여기의 라벨 문자열은 `api/generate-poster.ts`의 프롬프트 맵 키와
 *       반드시 정확히 일치해야 합니다(불일치 시 프롬프트 조각이 빠짐).
 * 각 배열 첫 항목을 기본 선택값으로 사용합니다.
 */

// CATEGORY 01 — 장르 Genre (8)
export const GENRE_OPTIONS = [
  '액션',
  'SF',
  '로맨스',
  '공포',
  '코미디',
  '느와르/범죄',
  '판타지',
  '재난',
];

// CATEGORY 02 — 분위기 Mood (6)
export const MOOD_OPTIONS = [
  '웅장한',
  '긴장감',
  '감성적인',
  '어두운',
  '유쾌한',
  '미스터리',
];

// CATEGORY 03 — 조명 Lighting (6)
export const LIGHTING_OPTIONS = [
  '역광 림라이트',
  '골든아워',
  '네온',
  '하이키',
  '로우키',
  '화염 백라이트',
];

// CATEGORY 04 — 구도 Composition (6)
export const COMPOSITION_OPTIONS = [
  '클로즈업',
  '전신 히어로샷',
  '로우앵글',
  '분할 몽타주',
  '실루엣',
  '부감(오버헤드)',
];

/** 인물수 상한(사진 첨부 가능 장수). 가이드 v2: 1~4명. */
export const MAX_PEOPLE = 4;

/**
 * 장르별 추천 제목 (가이드 v2).
 * 사용자가 제목을 비워두면 placeholder/기본값으로 사용합니다.
 */
export const RECOMMENDED_TITLES: Record<string, string> = {
  액션: '최후의 작전',
  SF: '2077: 마지막 신호',
  로맨스: '그 해, 우리의 봄',
  공포: '새벽 세 시',
  코미디: '대환장 패밀리',
  '느와르/범죄': '검은 도시',
  판타지: '천년의 검',
  재난: '붕괴',
};
