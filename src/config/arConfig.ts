/**
 * AR 프랍 애니메이션 설정 (Module A — Screen 6).
 * 재생시간/오브젝트 목록/최종 메시지는 미확정(TODO #5, #6) → 여기서 교체.
 */

export interface PropObject {
  /** GLB 내 노드/클립 식별용 키 또는 개별 GLB 파일명. */
  key: string;
  /** 표시 이름(디버그/로그용). */
  label: string;
  /** 등장 지연 (ms). */
  appearDelayMs: number;
}

// TODO(#4, #5): 실제 GLB 파일/오브젝트 목록으로 교체.
export const PROP_OBJECTS: PropObject[] = [
  { key: 'prop_01', label: '프랍 1', appearDelayMs: 0 },
  { key: 'prop_02', label: '프랍 2', appearDelayMs: 2000 },
  { key: 'prop_03', label: '프랍 3', appearDelayMs: 4000 },
  { key: 'prop_04', label: '프랍 4', appearDelayMs: 6000 },
  { key: 'prop_05', label: '프랍 5', appearDelayMs: 8000 },
  { key: 'prop_06', label: '프랍 6', appearDelayMs: 10000 },
  { key: 'prop_07', label: '프랍 7', appearDelayMs: 12000 },
  { key: 'prop_08', label: '프랍 8', appearDelayMs: 14000 },
  { key: 'chameleon', label: '카멜레온 캐릭터', appearDelayMs: 16000 },
];

/** Legacy 영상 경로. 현재 Screen 6은 이 mp4를 재생하지 않고 카멜레온/프랍을 바로 표시합니다. */
export const MODULE_A_VIDEO = '/assets/video/module-a.mp4';
export const CHAMELEON_AUDIO = '/assets/audio/cameleon_C05_v01.mp3';

// 실제 에셋 기준 재생시간(22초). onended로도 종료를 감지하지만 폴백 타임아웃에 사용.
export const ANIMATION_TOTAL_MS = 22000;

/**
 * Legacy 영상 플레인 종횡비 (1280x720 = 16:9).
 */
export const ANIMATION_ASPECT = 16 / 9;

export interface SkyAnchorPropModel {
  url: string;
  size: number;
  delay?: number;
  label?: string;
  persistent?: boolean;
  kind?: 'gltf' | 'sprite' | 'png-sequence';
  sprite?: {
    columns: number;
    rows: number;
    frameCount: number;
    fps: number;
    aspect: number;
  };
}

/**
 * Module A에서 바로 노출할 sky-anchor 프랍/카멜레온 자산.
 * Drive 폴더의 카멜레온 스프라이트/오디오와 sky-anchor-webar의 모델 자산을 함께 사용합니다.
 */
export const SKY_ANCHOR_PROP_MODELS: SkyAnchorPropModel[] = [
  {
    url: '/assets/sprites/chameleon/cameleon_c05_v01_atlas.png',
    label: '카멜레온 C05',
    kind: 'png-sequence',
    size: 0.62,
    sprite: {
      columns: 15,
      rows: 14,
      frameCount: 197,
      fps: 24,
      aspect: 256 / 144,
    },
  },
  {
    url: '/assets/models/sky-anchor/Megaphone_Ani_v02.glb',
    size: 0.546,
  },
  {
    url: '/assets/models/sky-anchor/Slate_Ani_v03.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/indian_hat_ani.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/movie_camera_ani_.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/harrypotter_ani_v08.glb',
    size: 0.46,
  },
  {
    url: '/assets/models/sky-anchor/r2d2_ani.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/movie_ticket_ani.glb',
    size: 0.72,
  },
  {
    url: '/assets/models/sky-anchor/gama_ani.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/man_in_black_medicine_ani.glb',
    size: 0.68,
  },
  {
    url: '/assets/models/sky-anchor/record_mic_glb_0616_V01.glb',
    size: 0.72,
  },
  {
    url: '/assets/models/sky-anchor/pan_0616_glb_V02.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/handphone_glb.glb',
    size: 0.52,
  },
  {
    url: '/assets/models/sky-anchor/woodbox_0616_glb_v01.glb',
    size: 0.64,
  },
  {
    url: '/assets/models/sky-anchor/movie_reel_0616_glb_V02.glb',
    size: 0.62,
  },
  {
    url: '/assets/models/sky-anchor/texi_0616_V07.glb',
    size: 0.68,
  },
  {
    url: '/assets/models/sky-anchor/Iron_man_ani_v04_optimized_nodraco.glb',
    size: 0.624,
  },
];

export const SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS = 2000;
export const SKY_ANCHOR_MODEL_VISIBLE_MS = 5000;
export const SKY_ANCHOR_MODEL_FADE_OUT_MS = 900;
export const SKY_ANCHOR_INTRO_SEQUENCE_MS = Math.ceil(
  SKY_ANCHOR_PROP_MODELS.reduce((duration, model, index) => {
    if (index !== 0 || model.kind !== 'png-sequence' || !model.sprite) return duration;
    return Math.max(duration, (model.sprite.frameCount / Math.max(model.sprite.fps, 1)) * 1000);
  }, 0),
);
const SKY_ANCHOR_SEQUENCE_MODEL_COUNT = SKY_ANCHOR_PROP_MODELS.filter(
  (model, index) => !model.persistent && !(index === 0 && model.kind === 'png-sequence'),
).length;
export const POST_VIDEO_PROPS_HOLD_MS =
  SKY_ANCHOR_INTRO_SEQUENCE_MS +
  Math.max(0, SKY_ANCHOR_SEQUENCE_MODEL_COUNT - 1) *
    SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS +
  SKY_ANCHOR_MODEL_VISIBLE_MS +
  400;

// (구) GLB 경로 — 영상 방식으로 대체됨. 추후 하이브리드 시 참고용으로 보존.
export const PROP_SCENE_GLB = '/assets/models/ar-scene.glb';

// TODO(#6/#7): 최종 메시지 텍스트 — 영상에 포함되어 있으면 불필요.
export const AR_FINAL_MESSAGE = '영화의 미래로, 함께.';

/**
 * 8th Wall 이미지 타겟(구조물 인식) 설정.
 *
 * 행사 구조물(부천국제판타스틱영화제 픽셀 벽면)을 이미지 타겟으로 인식하고,
 * 인식된 벽면 위에 동일 크기의 영상을 앵커링하여 재생합니다.
 *
 * 적용 순서(실기기/배포):
 *  1) 벽면 정면 고해상 사진을 8th Wall 이미지 타겟 CLI로 처리해 `public/assets/targets/`에 배치.
 *  2) imageUrl/targetName을 실제 값으로 교체.
 *  3) physicalWidthMeters에 벽면 실제 가로 폭(미터)을 넣으면 영상이 그 크기로 붙음.
 *  4) ENABLE_IMAGE_TARGET = true 로 켜고 실기기에서 테스트.
 *
 * 빛 변화(야외 콘트라스트)는 8th Wall의 특징점 기반 매칭이 내부적으로 처리하며,
 * 인식 신뢰도가 충분할 때 xrimagefound 가 발생합니다.
 */
export const STRUCTURE_TARGET = {
  /** XrController.configure({imageTargets:[...]}) 에 쓰는 타겟 이름. */
  name: 'bifan-structure',
  /** 타겟 원본 이미지(미리보기/커스텀 폴백용). TODO: 실제 벽면 사진으로 교체. */
  imageUrl: '/assets/targets/structure.jpg',
  /** 벽면 실제 가로 폭(미터). 영상 앵커 크기 기준. TODO: 실측값으로 교체. */
  physicalWidthMeters: 4.0,
};

/**
 * 8th Wall 이미지 타겟 인식 사용 여부.
 * Module A는 실제 AR 경로만 사용합니다. mock/fallback 카메라 경로는 제거했습니다.
 */
export const ENABLE_IMAGE_TARGET = true;
