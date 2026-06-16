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
  { key: 'prop_02', label: '프랍 2', appearDelayMs: 300 },
  { key: 'prop_03', label: '프랍 3', appearDelayMs: 600 },
  { key: 'prop_04', label: '프랍 4', appearDelayMs: 900 },
  { key: 'prop_05', label: '프랍 5', appearDelayMs: 1200 },
  { key: 'prop_06', label: '프랍 6', appearDelayMs: 1500 },
  { key: 'prop_07', label: '프랍 7', appearDelayMs: 1800 },
  { key: 'prop_08', label: '프랍 8', appearDelayMs: 2100 },
  { key: 'chameleon', label: '카멜레온 캐릭터', appearDelayMs: 2600 },
];

/**
 * Module A 프랍 애니메이션은 사전 렌더링된 mp4 영상으로 전달됨 (GLB 아님).
 * 8th Wall + Three.js VideoTexture로 인식된 구조물 위치에 앵커링하여 재생.
 */
export const MODULE_A_VIDEO = '/assets/video/module-a.mp4';

// 실제 에셋 기준 재생시간(22초). onended로도 종료를 감지하지만 폴백 타임아웃에 사용.
export const ANIMATION_TOTAL_MS = 22000;

/**
 * 영상 플레인 종횡비 (1280x720 = 16:9).
 * AR 앵커 시 플레인 가로 폭(월드 단위)에 곱해 세로를 계산.
 */
export const ANIMATION_ASPECT = 16 / 9;

export interface SkyAnchorPropModel {
  url: string;
  size: number;
  delay: number;
  x: number;
  y: number;
}

/**
 * Module A 영상 종료 뒤 노출할 sky-anchor 프랍 GLB.
 * sky-anchor-webar의 모델 자산/로딩 방식을 가져오되, Screen 6 본편 영상은 유지합니다.
 */
export const SKY_ANCHOR_PROP_MODELS: SkyAnchorPropModel[] = [
  {
    url: '/assets/models/sky-anchor/Slate_Ani_v02.glb',
    size: 0.42,
    delay: 0,
    x: -0.48,
    y: 0.04,
  },
  {
    url: '/assets/models/sky-anchor/Megaphone_Ani_v02.glb',
    size: 0.38,
    delay: 0.15,
    x: 0.02,
    y: -0.08,
  },
  {
    url: '/assets/models/sky-anchor/movie_ticket_ani.glb',
    size: 0.4,
    delay: 0.3,
    x: 0.5,
    y: 0.05,
  },
];

export const POST_VIDEO_PROPS_HOLD_MS = 5000;

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
 * 타겟 이미지/실기기 준비 전까지는 false → 기존 mock(시뮬레이션 버튼) 플로우로 동작.
 * 준비되면 true 로 켜면 실제 구조물 인식 + 벽면 앵커 영상으로 전환됩니다.
 */
export const ENABLE_IMAGE_TARGET = false;
