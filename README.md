# BIFAN 30주년 WebAR

부천국제판타스틱영화제(BIFAN) 30주년 기념 WebAR 콘텐츠.
Vite + TypeScript + Three.js, WebAR 엔진은 8th Wall, Vercel 정적 배포.

## 실행

```bash
npm install
npm run dev        # http://localhost:5173 (UI 작업용)
npm run dev:https  # 8th Wall/카메라 테스트용 (보안 컨텍스트 필요)
npm run build      # 타입체크 + 프로덕션 빌드
```

> 8th Wall과 카메라 권한은 보안 컨텍스트(HTTPS 또는 localhost)에서만 동작합니다.
> 실기기 AR 테스트는 `dev:https` 또는 ngrok 터널 + Vercel 배포 URL을 사용하세요.

## 현재 구현 범위 — Phase 1 (핵심 플로우)

| 화면 | 라우트 | 파일 | 상태 |
|------|--------|------|------|
| Screen 1 로딩 + 다운로드 모달 | `/` | `pages/LoadingPage.ts` | ✅ |
| Screen 2 다운로드 프로그레스 | `/` (내부 전환) | `pages/LoadingPage.ts` | ✅ (시뮬레이션) |
| Screen 3 30주년 감사 메시지 | `/message` | `pages/MessagePage.ts` | ✅ |
| Screen 4 AR 데이터 로딩 | `/ar-loading` | `pages/DataLoadingPage.ts` | ✅ (시뮬레이션) |
| Screen 5 AR 카메라 + 가이드라인 | `/ar-camera` | `pages/ARCameraPage.ts` | ✅ (카메라 실피드 + 인식 mock) |
| Screen 6 프랍 애니메이션 (Module A) | `/ar-animation` | `pages/ARAnimationPage.ts` | ✅ (mp4 영상 → 종료 후 sky-anchor GLB 프랍 표시) |
| Screen 7 포스터 카메라 (Module B) | `/poster` | `pages/PosterCameraPage.ts` | ✅ (촬영/갤러리, 카메라 없으면 샘플) |
| Screen 8 포스터 스타일 선택 | `/poster/style` | `pages/PosterStylePage.ts` | ✅ (드롭다운 4 + 제목) |
| Screen 9 포스터 생성 로딩 | `/poster/loading` | `pages/PosterLoadingPage.ts` | ✅ (placeholder API + 재시도) |
| Screen 10 포스터 생성 완료 | `/poster/result` | `pages/PosterResultPage.ts` | ✅ (저장하기 / 전시하기) |
| Screen 11 AR 포스터 전시 | `/poster/exhibit` | `pages/PosterExhibitPage.ts` | ✅ (8th Wall 월드트래킹 + 폴백) |

**Module A 애니메이션 본편은 mp4 영상 방식**입니다. 사전 렌더링된 22초 영상
(`public/assets/video/module-a.mp4`, 1280×720)을 Three.js `VideoTexture`로 평면에 입혀
재생합니다. 현재는 dev 프리뷰 모드(카메라 피드 위 영상 plane 오버레이)로 동작하며,
8th Wall 앱 키/이미지 타겟이 준비되면 `PropAnimationPlayer.attachToEighthWall()` +
`updateAnchorPose()`로 인식된 구조물 위치에 앵커링됩니다 (`ar/PropAnimationPlayer.ts`).
영상 종료 뒤에는 `sky-anchor-webar`의 GLB 모델 전체를 3개씩 batch로 순차 재생한 뒤
감사 메시지 화면으로 전환합니다
(`ar/SkyAnchorModelPlayer.ts`).

**Module B(AI 포스터)**: `포스터_프롬프트_가이드.md` v3 기준으로
장르8·분위기8·조명8·구도8 선택값과 장르별 자동 표정/제목/영문 부제를 조합합니다.
`api/generate-poster.ts`가 OpenAI 이미지 edit API를 호출하고, 키 미설정/실패 시
클라이언트 placeholder 포스터로 폴백합니다.

**AR 포스터 전시(Screen 11)**: 8th Wall이 2026년 **MIT 오픈소스(앱 키 불필요)**로
공개되어, `@8thwall/engine-binary`(CDN, SLAM 포함)를 동적 로드해 월드 트래킹 AR로
구동합니다(`ar/EighthWallController.ts`). 전시하기 클릭 시 `PosterExhibitManager`가
20슬롯 중 빈 슬롯(랜덤)에 부착, 만석이면 가장 오래된 슬롯을 대체하고, 본인 포스터에
파란 아웃글로우를 적용합니다(localStorage 임시 저장, 서버 동기화는 미결 #12).

> 8th Wall 로드 실패/카메라 미지원 시 자동으로 **폴백(카메라 피드 + 자이로/자동회전
> Three.js 뷰)** 으로 동작합니다. 실제 8th Wall 월드 트래킹은 카메라가 필요해
> 브라우저 프리뷰에서는 검증 불가 — 배포 URL을 **실기기**에서 테스트해야 합니다.

## 미확정 항목 처리 위치 (TODO)

| # | 항목 | 위치 |
|---|------|------|
| 1 | 다운로드 데이터 용량 | `config/appConfig.ts` → `DOWNLOAD_SIZE_MB` |
| 2 | 드롭다운 선택지 | ✅ 확정(장르8·분위기8·조명8·구도8=4,096) → `config/posterOptions.ts` |
| 3 | AI 이미지 생성 API | `api/generate-poster.ts` + 실패 시 `api/posterGenerate.ts` placeholder |
| 4 | 프랍 애니메이션 에셋 | mp4 본편 + sky-anchor 후속 GLB 프랍 |
| 5 | 애니메이션 재생시간 | 22초로 확정 → `config/arConfig.ts` → `ANIMATION_TOTAL_MS` |
| 6 | 최종 메시지 텍스트 | 영상에 포함 추정 (오버레이 필요시 `AR_FINAL_MESSAGE`) |
| 9 | QR 인식 폴백 | `config/appConfig.ts` → `ENABLE_QR_FALLBACK` |
| 10 | 8th Wall 이미지 타겟 파일 | `ar/EighthWallController.ts`, `ar/ImageTargetTracker.ts` |

## 아키텍처

- **라우터**: `utils/router.ts` — Hash 기반 SPA, `Page` 인터페이스(mount/unmount) 생명주기.
- **상태**: `store/appState.ts` — 의존성 없는 옵저버블 스토어.
- **AR**: `ar/ImageTargetTracker.ts`는 실제 카메라 피드 + mock 인식 이벤트. 8th Wall 연동 시
  `attachEighthWall()`이 `xrimagefound`/`xrimagelost`로 동일 인터페이스를 제공합니다.
- **공통 UI**: `components/` (Modal, ProgressBar, GuideFrame, Toast, Brand).

### AR 카메라 동작 확인 (Phase 1)

이미지 타겟 파일이 아직 없어, AR 카메라 화면 우측 하단의 **[시뮬레이션: 인식]**
버튼으로 인식/소실을 토글합니다. 인식 상태 3초 유지 시 다음 단계(프랍 애니메이션,
Phase 2 예정) 트리거가 발생합니다. 이미지 타겟 연동 시 이 버튼은 제거하세요.
