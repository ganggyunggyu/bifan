# BIFAN 30주년 WebAR

부천국제판타스틱영화제(BIFAN) 30주년 기념 WebAR 콘텐츠.
Vite + TypeScript + Three.js, Module A WebAR 엔진은 8th Wall, Vercel 정적 배포.

## 실행

```bash
npm install
npm run dev        # http://localhost:5181 (UI/로컬 AR 작업용)
npm run dev:https  # https://localhost:5181 (모바일 LAN 테스트용 self-signed HTTPS)
npm run tunnel     # 실기기/인앱 테스트용 HTTPS 터널(cloudflared)
npm run build      # 타입체크 + 프로덕션 빌드
```

> 로컬 데스크톱에서는 `http://localhost:5181` 또는 `http://127.0.0.1:5181`도
> 보안 컨텍스트로 인정되어 카메라 테스트가 가능합니다. 휴대폰에서
> `http://192.168.x.x:5181`처럼 LAN IP로 접속하는 경우에는 보안 컨텍스트가 아니므로
> Module A의 8th Wall 검증은 `npm run tunnel`, Vercel 배포 URL, 또는 신뢰된 인증서가
> 적용된 HTTPS가 필요합니다.

## 현재 구현 범위 — Phase 1 (핵심 플로우)

| 화면 | 라우트 | 파일 | 상태 |
|------|--------|------|------|
| Screen 1 로딩 + 다운로드 모달 | `/` | `pages/LoadingPage.ts` | ✅ |
| Screen 2 다운로드 프로그레스 | `/` (내부 전환) | `pages/LoadingPage.ts` | ✅ (시뮬레이션) |
| Screen 3 30주년 감사 메시지 | `/message` | `pages/MessagePage.ts` | ✅ |
| Screen 4 AR 데이터 로딩 | `/ar-loading` | `pages/DataLoadingPage.ts` | ✅ (`/ar-animation`으로 바로 진입) |
| Screen 6 프랍 애니메이션 (Module A) | `/ar-animation` | `pages/ARAnimationPage.ts` | ✅ (8th Wall + sky-anchor 프랍) |
| Screen 7 포스터 카메라 (Module B) | `/poster` | `pages/PosterCameraPage.ts` | ✅ (전면 촬영/갤러리, 권한 실패 시 사진 선택) |
| Screen 8 포스터 스타일 선택 | `/poster/style` | `pages/PosterStylePage.ts` | ✅ (드롭다운 4 + 제목) |
| Screen 9 포스터 생성 로딩 | `/poster/loading` | `pages/PosterLoadingPage.ts` | ✅ (placeholder API + 재시도) |
| Screen 10 포스터 생성 완료 | `/poster/result` | `pages/PosterResultPage.ts` | ✅ (저장하기 / 전시하기) |
| Screen 11 포스터 전시 (Module B) | `/poster/exhibit` | `pages/PosterExhibitPage.ts` | ✅ (카메라 피드 + Three.js 전시) |

**Module A 애니메이션 본편은 카멜레온/sky-anchor 프랍 방식**입니다. 기존 mp4 본편
(`public/assets/video/module-a.mp4`) 재생 단계는 제거했고, `/ar-animation` 진입 시
카메라 피드 위에 카멜레온 스프라이트, 카멜레온 오디오, sky-anchor GLB 모델을
중앙 기준으로 최대 3개까지 겹쳐 순차 재생한 뒤 감사 메시지 화면으로 전환합니다
(`ar/SkyAnchorModelPlayer.ts`, `pages/ARAnimationPage.ts`).

**Module B(AI 포스터)**: `포스터_프롬프트_가이드.md` v3 기준으로
장르8·분위기8·조명8·구도8 선택값과 장르별 자동 표정/제목/영문 부제를 조합합니다.
`api/generate-poster.ts`가 OpenAI 이미지 edit API를 호출하고, 키 미설정/실패 시
클라이언트 placeholder 포스터로 폴백합니다.

**8th Wall 적용 범위**: 8th Wall은 Module A(`/ar-animation`) 전용입니다.
`@8thwall/engine-binary`(SLAM 포함)를 `ar/EighthWallController.ts`에서 동적 로드해
프랍 애니메이션 카메라 배경에 사용합니다. 첫 플로우는 `/ar-loading` 이후
바로 `/ar-animation`으로 진입합니다.

**Module B 포스터 전시(Screen 11)**: `/poster/exhibit`는 8th Wall 대상이 아닙니다.
전시하기 클릭 시 `PosterExhibitManager`가 20슬롯 중 빈 슬롯(랜덤)에 부착하고,
카메라 피드 + 자이로/드래그 기반 Three.js 뷰에서 포스터를 둘러보게 합니다. 만석이면
가장 오래된 슬롯을 대체하고, 본인 포스터에는 파란 아웃글로우를 적용합니다
(localStorage 임시 저장, 서버 동기화는 미결 #12).

## 미확정 항목 처리 위치 (TODO)

| # | 항목 | 위치 |
|---|------|------|
| 1 | 다운로드 데이터 용량 | `config/appConfig.ts` → `DOWNLOAD_SIZE_MB` |
| 2 | 드롭다운 선택지 | ✅ 확정(장르8·분위기8·조명8·구도8=4,096) → `config/posterOptions.ts` |
| 3 | AI 이미지 생성 API | `api/generate-poster.ts` + 실패 시 `api/posterGenerate.ts` placeholder |
| 4 | 프랍 애니메이션 에셋 | 카멜레온 스프라이트/오디오 + sky-anchor GLB 프랍 |
| 5 | 애니메이션 재생시간 | 22초로 확정 → `config/arConfig.ts` → `ANIMATION_TOTAL_MS` |
| 6 | 최종 메시지 텍스트 | 프랍 재생 후 `/message`로 전환 |
| 9 | QR 인식 폴백 | `config/appConfig.ts` → `ENABLE_QR_FALLBACK` |
| 10 | Module A 8th Wall 엔진 파일 | `ar/EighthWallController.ts`, `pages/ARAnimationPage.ts` |

## 아키텍처

- **라우터**: `utils/router.ts` — Hash 기반 SPA, `Page` 인터페이스(mount/unmount) 생명주기.
- **상태**: `store/appState.ts` — 의존성 없는 옵저버블 스토어.
- **Module A AR**: `ar/EighthWallController.ts`가 8th Wall 엔진 로드와 월드 트래킹
  씬 구성을 담당합니다.
- **Module B 카메라/전시**: `ar/ImageTargetTracker.ts`와 `CameraManager.ts`가 일반
  getUserMedia 카메라 피드를 담당하고, 포스터 전시는 Three.js 폴백 렌더러로 처리합니다.
- **공통 UI**: `components/` (Modal, ProgressBar, GuideFrame, Toast, Brand).

### AR 카메라 동작 확인 (Phase 1)

`/ar-loading`이 끝나면 바로 `/ar-animation`으로 이동합니다. `/ar-animation`은
Module A 프랍 애니메이션 화면으로, 8th Wall 카메라 세션 위에 sky-anchor GLB
프랍을 순차 표시합니다.
