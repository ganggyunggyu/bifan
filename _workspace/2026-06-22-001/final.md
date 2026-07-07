검증 일시: 2026-06-22 KST  
대상: Module 2 / AI 포스터 생성 플로우  
로컬 서버: PM2 `bifan-dev`  
확인 링크: http://127.0.0.1:5181/#/poster

## 결론

로컬 기준으로 Module 2 흐름은 끝까지 정상으로 확인했습니다.

촬영 화면에서 시작해서 스타일 선택, 포스터 생성 결과, AR 전시 화면까지 끊기지 않고 이동했습니다. 빌드도 함께 확인했고 `npm run build`는 통과했습니다.

다만 지금 켜져 있는 PM2 서버는 Vite dev 서버라 `/api/generate-poster` 서버리스 함수는 연결되어 있지 않습니다. 그래서 실제 OpenAI 이미지 생성 대신 앱 안의 placeholder fallback이 동작했습니다. 이번 검증은 “로컬 화면 흐름과 fallback 동작이 정상인지”를 확인한 것으로 보시면 됩니다.

OpenAI 실생성까지 확인하려면 Vercel dev나 배포 URL에서 한 번 더 검증하는 게 맞습니다.

## 확인한 내용

| 확인 항목 | 결과 | 메모 |
| --- | --- | --- |
| `/poster` 촬영 화면 진입 | 정상 | 카메라 권한이 막힌 환경에서는 샘플/fallback 화면이 뜹니다. |
| 가이드 캐러셀 닫기 | 정상 | `다음` 3회 후 제작 CTA까지 이동했습니다. |
| 촬영 후 다음 버튼 | 정상 | 촬영 후 `다음 (1/4)` 버튼이 활성화됐습니다. |
| `/poster/style` 이동 | 정상 | 스타일 선택 화면으로 정상 이동했습니다. |
| 스타일 선택 UI | 정상 | 드롭다운과 제목 입력 상태를 확인했습니다. |
| `제작하기` 후 결과 생성 | 정상 | `/poster/result`로 이동했고 결과 이미지가 표시됐습니다. |
| `전시하기` 후 AR 전시 | 정상 | `/poster/exhibit`로 이동했고 canvas가 표시됐습니다. |
| 빌드 | 정상 | `npm run build`가 통과했습니다. |

## 증거

- 스크린샷 파일: `/Users/ganggyunggyu/Documents/부천 영화제/bifan/work/module-b-local-recheck.png`
- 최종 확인 URL: `http://127.0.0.1:5181/#/poster/exhibit`
- 생성 결과: `data:image/png;base64,...` 형태의 placeholder 이미지 생성 확인
- AR 전시 화면: canvas 1개 표시 확인

## 확인된 경고

| 경고 | 판단 |
| --- | --- |
| `[CameraManager] camera unavailable NotAllowedError: Permission denied` | 인앱 브라우저에서 카메라 권한이 거부되어 발생한 경고입니다. 로컬 검증 범위에서는 허용 가능한 fallback입니다. |
| `[generatePoster] api fallback, status 404` | Vite dev 서버에는 서버리스 API가 붙어 있지 않아 발생했습니다. 이 경우 placeholder fallback으로 넘어가는 동작이 정상입니다. |

## 남은 리스크

1. OpenAI 실생성은 로컬 Vite dev가 아니라 Vercel dev 또는 배포 URL에서 확인해야 합니다.
2. 실제 모바일 기기에서 카메라 권한을 허용한 뒤 WebAR 카메라 흐름을 다시 봐야 합니다.
3. `저장하기` 버튼은 다운로드/공유 동작이 생길 수 있어 이번 자동 검증에서는 누르지 않았습니다.

## 다음 확인 권장

1. Vercel dev 또는 production URL에서 `/api/generate-poster` 실제 OpenAI 생성 확인
2. 모바일 기기에서 카메라 권한 허용 후 `/poster` 촬영 플로우 재확인
3. `/poster/exhibit`에서 실제 카메라 기반 AR 전시 상태 확인

## 시각 확인

아래 스크린샷은 `/poster/exhibit`까지 넘어간 상태입니다. 포스터가 AR 전시 화면에 올라온 것을 눈으로 확인할 수 있습니다.

<!-- HUMANIZE-SUMMARY
original_chars=1954
revised_chars=2063
change_rate_estimate=22%
detections_before=A-2:1,D-1:1,E-1:1,H-1:1,J-3:1
detections_after=S1:0,S2:2
self_check=6/6
grade=A
highlights=결론 문단을 운영자가 읽기 쉬운 존댓말로 완화; 경고 판단을 설명형 문장으로 정리; 다음 확인사항은 사실 유지 후 자연스럽게 다듬음
-->
