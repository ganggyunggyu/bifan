# BIFAN WebAR — 세션 핸드오프 (다음 세션용)

> 이 문서는 직전 세션의 작업/결정/미결사항을 다음 세션이 바로 이어받기 위한 요약이다.
> 코드 구조 상세는 `README.md` 참고. 이 문서는 "지금 어디까지 했고, 무엇을 알아야 하는가"에 집중.

---

## 1. 프로젝트 한눈에

- **무엇**: 부천국제판타스틱영화제(BIFAN) 30주년 기념 **WebAR 체험 앱**
- **위치**: `/Users/edward/Documents/claude/bifan`
- **스택**: Vite + TypeScript + Three.js(0.184), 해시 라우터 SPA, Vercel(정적 + 서버리스 함수), 8th Wall(오픈소스)
- **라이브 URL(고정/상시)**: **https://bifan.vercel.app**
  - Vercel 프로젝트: `jinsu89365-5441s-projects/bifan` (계정: jinsu89365-5441)
  - 맥 꺼져도 24시간 상시 운영됨(Hobby 무료)
- **출력 비율**: 세로 2:3 (영화 포스터)

## 2. 전체 플로우 (현재 순서 — 중간에 재정렬했음)

```
LoadingPage(/)  다운로드 모달 → 실제 에셋 사전다운로드(MB 표시, blob 캐시)
  → DataLoadingPage(/ar-loading)  "AR 콘텐츠 준비 중" 짧게
  → ARCameraPage(/ar-camera)  구조물 인식 (지금은 mock '시뮬레이션' 버튼)
  → ARAnimationPage(/ar-animation)  Module A 22초 mp4 영상(전체화면)
  → /message-intro  300ms 로딩
  → MessagePage(/message)  30주년 감사 메시지(순차 fade)
  → /poster-intro  3초 로딩
  → PosterCameraPage(/poster)  사진 촬영(전/후면 전환) / 갤러리
  → PosterStylePage(/poster/style)  장르·분위기·조명·구도 + 제목
  → PosterLoadingPage(/poster/loading)  AI 생성(~30s)
  → PosterResultPage(/poster/result)  저장 / 전시
  → PosterExhibitPage(/poster/exhibit)  AR 전시(20슬롯)
```
라우트/순서는 `src/utils/router.ts`(ROUTES) + `src/main.ts`(register) + 각 페이지의 navigate.

## 3. 기능별 현재 상태

| 기능 | 상태 | 메모 |
|---|---|---|
| 로딩/다운로드 | ✅ | 실제 에셋(mp4+안내이미지) 사전다운로드, MB 표시, blob 재생 → 영상 끊김 방지. `utils/assetPreloader.ts` |
| 30주년 메시지 | ✅ | 영상 뒤로 이동됨 |
| 구조물 인식(Module A) | ⚠️ wiring만 | `arConfig.ENABLE_IMAGE_TARGET=false` → mock 버튼. 켜려면 §6 |
| 프랍 영상(Module A) | ✅ | mp4 전체화면(contain). 8th Wall 벽면 앵커는 wiring만(OFF) |
| 포스터 카메라 | ✅ | 전/후면 전환(🔄), 셀카 미러, 갤러리 |
| 안내 캐러셀 | ✅ | `public/assets/guide/step1~4.png` 이미지 스와이프 |
| **AI 포스터 생성** | ✅ (가장 많이 반복) | §5 상세 |
| 포스터 저장 | ✅ | Web Share / 다운로드 |
| AR 전시(Screen 11) | ✅ | 20슬롯 링, 본인 포스터 아웃글로우, 8th Wall 월드트래킹 + 자이로/카메라 폴백, **자동회전 제거+자이로 보간(고정됨)** |
| iPad/태블릿 | ✅ | 큰 폰 프레임 + 어두운 배경 (style.css 미디어쿼리) |
| 공유 카메라 | ✅ | `ar/CameraManager.ts` 싱글톤 — 권한 1회 |
| 로고 스트립 | 제거됨 | 로딩 화면 하단 3사 로고 삭제 |
| GPS AR 씬 | ⚠️ 스캐폴드 | `public/ar-location.html` (A-Frame+AR.js). `prop.glb` 필요 |

## 4. OpenAI(ChatGPT) 연동 — 중요

- **키**: Vercel 환경변수 `OPENAI_API_KEY` 에 사용자가 직접 설정함(대시보드).
  - ⚠️ **사용자가 채팅에 키를 노출**했고 "나중에 폐기"한다고 함 → **다음 세션에서 키 폐기/교체 여부 확인**.
- **모델**: **gpt-image-1** 사용 (dall-e-3 아님!).
  - dall-e-3는 이 키의 images 엔드포인트에서 `style`/`response_format`/`quality:hd`/`1024x1792` 파라미터를 전부 거부함 → gpt-image-1로 확정.
  - `images/edits` (사진 입력 → 얼굴 보존), size `1024x1536`, quality `medium`.
- **태그라인**: `gpt-4o-mini` 로 한국어 태그라인 병렬 생성.
- **시간/비용**: 생성 ~25~45초 (Vercel 함수 60초 한도에 다소 근접 — quality high는 타임아웃 위험으로 제외). 호출당 OpenAI 요금 발생.
- 함수: `api/generate-poster.ts` (입력 사진은 **클라이언트에서 1024px JPEG 압축** 후 전송 — Vercel 본문 4.5MB 한도 때문. 원본 PNG는 한도 초과 → 과거 "안 불러와짐" 버그 원인이었음).

## 5. AI 포스터 파이프라인 (가장 많이 반복한 부분 — 결정 히스토리)

**최종 구조**:
1. 사용자 사진(압축) → `gpt-image-1 edits` → **얼굴 보존된 포스터 아트** (글자 없음)
2. 병렬로 `gpt-4o-mini` → 한국어 태그라인
3. **클라이언트가 한글 텍스트를 오버레이**(`src/api/posterGenerate.ts` → `renderPosterText`):
   - 상단 태그라인(레터스페이싱 + 양옆 짧은 라인)
   - 하단 제목 = **메인 디자인 요소**(흰→골드 그라데이션 + 외곽선 + 그림자 + 위 액센트 라인, 폭 자동 맞춤)
   - **흰 밴드/BIFAN/크레딧/개봉일 전부 없음**(사용자 요청)

**프롬프트**: **BIFAN 옵션&프롬프트 설계서 v1.0** 적용 (`api/generate-poster.ts`의 `BASE_PROMPT`, `NEGATIVE_PROMPT`, `GENRE/MOOD/LIGHTING/COMPOSITION_PROMPTS`). 원본 설계서 HTML: `/Users/edward/Downloads/BIFAN_~3.HTM`.

**중요 결정/학습(왜 이렇게 됐나)**:
- ❌ text-to-image(새 인물 생성) → 사용자가 "얼굴 그대로" 원함 → ✅ edits(얼굴 보존)
- ❌ 과한 프롬프트 → "너무 정제됨" 불만 → 단순화했다가 → **설계서 v1.0 프롬프트로 최종 확정**
- ✅ 한글 텍스트는 앱이 그림(AI는 한글 깨뜨림)
- ✅ "자연스럽게, BIFAN 브랜딩/크레딧 제거" 요청 반영
- gpt-4o Vision은 "사진 속 인물 묘사"를 프라이버시로 거부함 → 과거엔 "가상 캐릭터 일반 특징"으로 우회했으나, **현재 edits 방식에선 Vision 불필요**(사진이 직접 입력).

**검증됨**: 느와르 선택 → 페도라+트렌치코트+담배+빗속 네온 = 설계서 의도대로 정확히 생성, 얼굴 보존.

## 6. 미결/사용자에게 필요한 것 (다음 세션 우선순위)

1. **구조물 실제 인식 켜기**: `public/assets/targets/structure.jpg`(벽면 정면 사진) 필요 → 8th Wall image-target CLI로 처리 → `arConfig.ts`의 `ENABLE_IMAGE_TARGET=true`, `physicalWidthMeters` 실측 → 인식 시 **벽면 크기로 영상 앵커 재생**(`PropAnimationPlayer.updateAnchorPose` 이미 구현). 실기기 HTTPS 테스트 필요.
2. **GPS AR 씬**: `public/assets/models/prop.glb` 필요(`/ar-location.html`).
3. **OpenAI 키 폐기/교체** (노출됨).
4. **결정 대기**:
   - 포스터에 "BIFAN 30" 워터마크 다시 넣을지 (설계서엔 있으나 사용자가 빼라고 함 → 현재 없음)
   - 멀티 얼굴(2·3인) 지원 여부 (설계서엔 1~3인, 현재는 사진에 있는 대로만)
   - 포스터 하단 밴드: 흰색 vs 없음(현재 없음)
5. **8th Wall 이미지타겟/GPS는 실기기에서만 검증 가능** (프리뷰엔 카메라 없음).

## 7. 배포/개발 (필수 주의)

- **배포**: `cd /Users/edward/Documents/claude/bifan && npx vercel --prod --yes`
  - ⚠️ **세션 바뀌면 셸 작업디렉터리가 워크스페이스 루트로 리셋됨** → 반드시 `cd bifan` 먼저! 안 하면 엉뚱한 디렉터리 배포 + 스트레이 `claude` Vercel 프로젝트 생성됨(이미 한 번 발생, 빈 프로젝트라 무해하나 정리 가능: `npx vercel remove claude --yes`).
- **로컬 개발**: `npm run dev` (포트 5181). 프리뷰 launch.json 이름 `bifan-dev`(워크스페이스 `/Users/edward/Documents/claude/.claude/launch.json`에 등록됨).
- **임시 외부공유**: `npm run tunnel` (cloudflared, 임시 URL).
- **빌드**: `npm run build` (tsc + vite). `api/` 폴더는 앱 tsc 대상 아님 → Vercel이 별도 빌드. 타입 느슨하게 작성됨.
- **프리뷰 검증 팁**: 카메라/AR/실제 생성은 프리뷰에서 검증 제한적. 포스터 오버레이 디자인은 생성된 이미지를 `public/_tmp_poster.png`로 복사 후 브라우저 eval로 캔버스 미리보기(임시파일은 끝나고 삭제).

## 8. 기타 메모

- **8th Wall**: 2026년 **MIT 오픈소스 + 무료(앱 키 불필요)**. `@8thwall/engine-binary` CDN, SLAM 포함. 기존 `XR8.addCameraPipelineModules/Threejs.pipelineModule/run` API 유지. `ar/EighthWallController.ts`.
- **헤더**: `vercel.json`에 COOP/COEP `require-corp` (8th Wall SLAM용). 유지 중.
- **mp4 에셋**: `public/assets/video/module-a.mp4` (22초, 1280x720, 18MB). `arConfig.ANIMATION_TOTAL_MS=22000`.
- **드롭다운 항목**(확정): 장르8·분위기6·조명6·구도6 = 1,728조합. `src/config/posterOptions.ts`. 라벨은 `api/generate-poster.ts`의 프롬프트 맵 키와 정확히 일치해야 함.
- 예전 핸드오프 zip(`~/Desktop/bifan-webar.zip`)은 **구버전**(이후 많이 바뀜).

## 9. 마지막 작업 (이 세션 종료 시점)

BIFAN 설계서 v1.0의 카테고리별 프롬프트 + BASE + NEGATIVE를 `api/generate-poster.ts`에 적용·배포 완료. 느와르 결과로 검증함. 열린 질문: BIFAN 워터마크 on/off, 멀티 얼굴 지원.
