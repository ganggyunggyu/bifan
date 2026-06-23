# BIFAN Module 2 실제 AI 이미지 생성 검증 기록

검증 일시: 2026-06-22 KST  
대상: Module 2 / AI 포스터 생성 플로우  
로컬 서버: PM2 `bifan-dev`  
확인 링크: http://127.0.0.1:5181/#/poster

## 결론

로컬에서 Module 2의 실제 OpenAI 이미지 생성까지 정상 동작 확인.

이전에는 PM2가 Vite dev 서버만 실행 중이라 `/api/generate-poster`가 404로 떨어지고 placeholder fallback이 동작했다. 현재는 PM2를 `npm run dev:full` 기준으로 실행하고, Vercel dev + Vite 개발 모듈이 함께 동작하도록 `vercel.json` rewrite 예외를 수정했다.

검증 결과 `/poster` → 이미지 업로드 → `/poster/style` → `제작하기` → `/api/generate-poster` 200 → `/poster/result` 결과 이미지 표시까지 정상이다. 결과 화면 DOM의 이미지 `src`와 API 응답 `imageUrl`이 동일했다.

## 검증 결과

| 항목 | 결과 | 메모 |
| --- | --- | --- |
| PM2 서버 | 정상 | `bifan-dev`, `npm run dev:full` |
| 프론트 모듈 로드 | 정상 | `/src/main.ts`가 `text/javascript`로 응답 |
| API validation | 정상 | 빈 요청 400 |
| 실제 AI 생성 API | 정상 | `/api/generate-poster` 200 |
| API 응답 시간 | 정상 | 42.358초 |
| API 이미지 data URL 길이 | 정상 | 3,752,658자 |
| 결과 화면 이미지 길이 | 정상 | 3,752,658자 |
| API/DOM 이미지 일치 | 정상 | `sameApiAndDomImage: true` |
| fallback 경고 | 없음 | 클라이언트 fallback 로그 없음 |
| 빌드 | 정상 | `npm run build` 통과 |

## 증거

- E2E 리포트: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e-report.json`
- 결과 화면 스크린샷: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e.png`
- 실제 생성 이미지: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e-output.png`
- API 단독 생성 이미지: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-api-test-output-5181.png`

## 확인한 화면 흐름

| 단계 | 결과 |
| --- | --- |
| `/poster` 촬영/업로드 화면 진입 | 정상 |
| 이미지 업로드 | 정상 |
| `다음 (1/4)` 활성화 | 정상 |
| `/poster/style` 이동 | 정상 |
| 제목/부제 입력 | 정상 |
| `제작하기` 실행 | 정상 |
| `/poster/loading` 표시 | 정상 |
| OpenAI 이미지 생성 | 정상 |
| `/poster/result` 표시 | 정상 |
| 저장/전시/다시 만들기 버튼 표시 | 정상 |

## 남은 리스크

1. 이미지 모델 특성상 포스터 내부 텍스트는 오타가 날 수 있음. 이번 결과에서도 영문 부제가 `BIFAN AI POSTER UI EZE`처럼 렌더됨.
2. 실제 모바일 카메라 권한과 WebAR 카메라 전시는 실기기에서 추가 확인 필요.
3. `저장하기` 버튼은 다운로드/공유 동작이 생길 수 있어 이번 자동 검증에서는 누르지 않음.
