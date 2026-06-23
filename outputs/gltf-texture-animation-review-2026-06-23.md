# glTF 텍스처 애니메이션 검토 메모

## 결론

`gltf texture animation guide.html`의 핵심은 GLB 내부에 PNG 시퀀스를 영상처럼 넣는 방식은 표준 glTF로 풀 수 없고, 웹 AR에서는 런타임 텍스처 제어로 가야 한다는 점이다.

우리 BIFAN 프로젝트는 이미 카멜레온에 `스프라이트 시트 + UV 오프셋` 방식을 적용하고 있다. 따라서 회의에서는 새 기능 도입보다 `이 방식을 공식 에셋 파이프라인으로 확정할지`, `어떤 경우에 GLB 애니메이션/비디오 텍스처와 나눌지`, `모바일 로딩/메모리 예산을 어디까지 잡을지`를 논의하는 편이 맞다.

## 현재 프로젝트와 맞는 부분

- Module A는 기존 mp4 본편 대신 카메라 피드 위에 카멜레온 스프라이트, 오디오, sky-anchor GLB 모델을 3개씩 batch로 재생한다. 근거: `README.md:37-41`.
- `SkyAnchorPropModel`은 `kind: 'gltf' | 'sprite'`와 스프라이트 메타데이터를 이미 지원한다. 근거: `src/config/arConfig.ts:40-53`.
- 카멜레온은 `cameleon_blink_atlas.png`를 `columns: 14`, `rows: 13`, `frameCount: 181`, `fps: 30`으로 재생한다. 근거: `src/config/arConfig.ts:60-72`.
- 실제 재생은 `Texture.repeat`와 `Texture.offset`으로 프레임을 넘기는 방식이다. 근거: `src/ar/SkyAnchorModelPlayer.ts:167-175`, `src/ar/SkyAnchorModelPlayer.ts:634-640`.
- GLB 프랍은 별도로 `AnimationMixer`로 클립을 1회 재생한다. 근거: `src/ar/SkyAnchorModelPlayer.ts:623-631`.

## 회의에서 이야기할 개선안

1. 에셋 타입 기준을 정하자.
   - 짧은 2D 루프, 투명 캐릭터, 이펙트: 스프라이트 시트 + UV 오프셋.
   - 실제 3D 오브젝트 움직임: GLB 애니메이션 + `AnimationMixer`.
   - 수십~수백 프레임의 긴 실사/연출 영상: `VideoTexture`.
   - 이 기준을 정하면 제작팀이 "GLB에 PNG 시퀀스를 넣어달라"는 방향으로 가지 않고, 처음부터 맞는 납품 포맷을 고를 수 있다.

2. 스프라이트 메타데이터를 하드코딩에서 manifest 기반으로 바꾸자.
   - 현재 `cameleon_blink_manifest.json`에는 image, frameCount, fps, columns, rows, cellWidth, cellHeight가 들어 있다.
   - 그런데 앱 설정은 `arConfig.ts`에 같은 값을 수동으로 적고 있다.
   - 다음 개선은 manifest를 읽거나 manifest에서 TypeScript 설정을 생성해서 값 불일치를 막는 것이다.

3. 다운로드 용량 표시를 실제 활성 프리로드 기준으로 정리하자.
   - 활성 프리로드 대상은 카멜레온 아틀라스/오디오 + 16개 GLB + guide 이미지이고, 로컬 파일 크기 기준 약 36MB다.
   - 전체 `public/assets/models/sky-anchor`는 약 66MB, `public/external/xr`는 약 34MB, 전체 assets는 약 88.5MB다.
   - `DOWNLOAD_SIZE_MB` fallback은 77MB로 되어 있어 실제 활성 프리로드 체감과 다를 수 있다.
   - 회의 포인트: 사용자에게 보이는 다운로드 수치를 "실제 프리로드 대상" 기준으로 할지, "전체 AR 준비 자산" 기준으로 할지 결정.

4. 카멜레온 스프라이트의 GPU 메모리 예산을 확인하자.
   - `cameleon_blink_atlas.png`는 파일 크기는 약 4MB지만 픽셀 크기가 3584 x 2288이다.
   - GPU에서는 압축 파일 크기가 아니라 픽셀 버퍼 기준으로 잡히므로 대략 31MB 이상을 먹을 수 있다.
   - 저사양 iPhone/Android에서 프레임 드랍이 있으면 15fps/저해상도 atlas variant, 프레임 컷다운, 또는 비디오 텍스처 전환을 검토한다.

5. 배포 public 자산을 정리하자.
   - 현재 활성 목록에 없는 GLB도 `public/assets/models/sky-anchor`에 많이 남아 있고, Vercel ignore는 `public` 자산을 제외하지 않는다.
   - 배포물 크기, 캐시 관리, 회귀 리스크를 줄이려면 `active/unused` 폴더 분리나 배포 전 asset manifest 기반 복사 스크립트를 두는 게 좋다.

6. 가이드의 방식 B는 우리 앱의 1순위가 아니다.
   - 노드 가시성 플립북은 model-viewer처럼 셰이더/런타임 제어가 제한된 환경에서 유리하다.
   - 우리 프로젝트는 Three.js/8th Wall을 직접 제어하므로, B는 납품사가 GLB 하나만 줄 수 있는 예외 상황용으로 두는 정도가 맞다.

## 바로 할 수 있는 후속 작업

- `scripts/validate-ar-assets.mjs`: `SKY_ANCHOR_PROP_MODELS`의 파일 존재, 크기, 총량, manifest 값 일치 여부를 검사.
- `scripts/build-sprite-descriptor.mjs`: `cameleon_blink_manifest.json`에서 `arConfig.ts`용 descriptor를 생성.
- `outputs/ar-asset-budget.json`: 활성 프리로드 총량과 배포 public 총량을 매번 기록.
- 실기기 테스트 체크: iPhone Safari, Android Chrome에서 카멜레온 30fps 유지 여부, 첫 로딩 시간, 발열/메모리 증상.
