# 구조물 이미지 타겟 (8th Wall)

이 폴더에 **행사 구조물(픽셀 벽면) 정면 사진**을 넣고 8th Wall 이미지 타겟으로
등록하면, AR 카메라가 구조물을 인식하고 인식된 벽면 위에 영상을 앵커링해 재생합니다.

## 적용 순서

1. **벽면 정면 사진 준비**
   - 평평한 패턴 벽면이 정면으로 꽉 차게 보이는 고해상 사진(JPG/PNG).
   - 그늘/정오 등 대표 조도 1~2장이면 충분(특징점 매칭이 빛 변화는 흡수).
   - 이 폴더에 `structure.jpg` 로 저장.

2. **8th Wall 이미지 타겟 처리**
   - 오픈소스 8th Wall의 *image target CLI tool* 로 `structure.jpg` 를 처리해
     엔진이 로드할 타겟 데이터를 생성합니다. (repo: 8thwall/8thwall → apps/image-target CLI)
   - 생성된 타겟을 `XrController` 가 `'bifan-structure'` 이름으로 인식하도록 연결.

3. **설정값 교체** — `src/config/arConfig.ts`
   - `STRUCTURE_TARGET.imageUrl` → 실제 파일 경로
   - `STRUCTURE_TARGET.physicalWidthMeters` → **벽면 실제 가로 폭(미터)** (영상이 이 크기로 붙음)
   - `ENABLE_IMAGE_TARGET = true`

4. **실기기 테스트(HTTPS)**
   - 카메라로 구조물을 비추면 → 인식 시 가이드 초록 → 3초 유지 → 벽면 위에서 영상 재생.
   - 인식이 까다로우면 사진 각도/해상도, physicalWidthMeters를 조정.

## 동작 코드 위치
- 세션/이벤트: `src/ar/EighthWallController.ts` (`startImageTarget`)
- 인식→3초→앵커 영상: `src/pages/ARCameraPage.ts`
- 벽면 크기 앵커링: `src/ar/PropAnimationPlayer.ts` (`updateAnchorPose`)

> ENABLE_IMAGE_TARGET=false(기본)일 때는 시뮬레이션 버튼 기반 mock으로 동작합니다.
