검증 일시: 2026-06-22 KST  
대상: Module 2 / AI 포스터 생성 플로우  
로컬 서버: PM2 `bifan-dev`  
확인 링크: http://127.0.0.1:5181/#/poster

## 결론

Module 2는 로컬에서 실제 OpenAI 이미지 생성까지 정상으로 확인했습니다.

이전 검증에서는 PM2가 Vite dev 서버만 보고 있어서 `/api/generate-poster`가 404로 떨어졌고, 그 결과 placeholder 이미지가 생성됐습니다. 이번에 PM2 실행 방식을 Vercel dev 기반으로 바꾸고, `vercel.json` rewrite가 Vite 개발 모듈을 막지 않도록 수정한 뒤 다시 확인했습니다.

현재는 `/poster`에서 사진 업로드, 스타일 선택, `제작하기`, `/api/generate-poster` 200 응답, `/poster/result` 결과 이미지 표시까지 이어집니다. 결과 화면의 이미지 `src`도 API 응답의 `imageUrl`과 정확히 일치했습니다.

## 실제 AI 생성 검증

| 항목 | 결과 | 메모 |
| --- | --- | --- |
| 로컬 서버 | 정상 | PM2 `bifan-dev`, `npm run dev:full` |
| 프론트 모듈 로드 | 정상 | `/src/main.ts`가 `text/javascript`로 응답 |
| API 라우트 | 정상 | 빈 요청은 400 validation, 실제 요청은 200 |
| 실제 생성 API | 정상 | `/api/generate-poster` 200 |
| API 응답 시간 | 정상 | 42.358초 |
| API 이미지 길이 | 정상 | data URL 3,752,658자 |
| 결과 화면 이미지 | 정상 | DOM 이미지 길이 3,752,658자 |
| API/DOM 이미지 일치 | 정상 | `sameApiAndDomImage: true` |
| fallback 경고 | 없음 | `[generatePoster] api fallback` 없음 |
| 빌드 | 정상 | `npm run build` 통과 |

## 증거 파일

- E2E 리포트: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e-report.json`
- 결과 화면 스크린샷: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e.png`
- 실제 생성 이미지: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e-output.png`
- API 단독 생성 이미지: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-api-test-output-5181.png`

## 확인한 화면 흐름

| 단계 | 결과 |
| --- | --- |
| `/poster` 진입 | 정상 |
| 갤러리 이미지 업로드 | 정상 |
| `다음 (1/4)` 활성화 | 정상 |
| `/poster/style` 이동 | 정상 |
| 제목/부제 입력 | 정상 |
| `제작하기` 실행 | 정상 |
| `/poster/loading` 표시 | 정상 |
| OpenAI 이미지 생성 | 정상 |
| `/poster/result` 표시 | 정상 |
| 저장/전시/다시 만들기 버튼 표시 | 정상 |

## 남은 리스크

1. 이미지 모델 특성상 포스터 안의 영문 텍스트는 오타가 날 수 있습니다. 이번 결과도 `BIFAN AI POSTER UI E2E`가 `BIFAN AI POSTER UI EZE`처럼 렌더됐습니다.
2. 실제 모바일 카메라 권한과 WebAR 카메라 전시 흐름은 실기기에서 한 번 더 보는 게 좋습니다.
3. `저장하기` 버튼은 다운로드/공유 동작이 생기므로 이번 자동 검증에서는 누르지 않았습니다.

## 시각 확인

아래 파일을 보면 실제 생성 이미지가 결과 화면에 올라온 상태를 바로 확인할 수 있습니다.

`/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/ai-ui-generation-e2e.png`
