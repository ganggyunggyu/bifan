import type { Page } from './Page';
import { showToast } from '../components/Toast';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/**
 * [Module B — Screen 10] 포스터 생성 완료.
 * 저장하기 / 전시하기 / 다시 만들기.
 */
export class PosterResultPage implements Page {
  mount(root: HTMLElement): void {
    const posterUrl = appState.get().generatedPosterUrl;
    if (!posterUrl) {
      router.navigate(ROUTES.poster);
      return;
    }

    const screen = document.createElement('div');
    screen.className = 'screen poster-result-page scrollable';

    const title = document.createElement('h1');
    title.className = 'poster-result__title';
    title.textContent = '포스터 생성 완료';
    screen.appendChild(title);

    const img = document.createElement('img');
    img.className = 'poster-result__image';
    img.src = posterUrl;
    img.alt = '생성된 영화 포스터';
    screen.appendChild(img);

    const actions = document.createElement('div');
    actions.className = 'poster-result__actions';

    const save = document.createElement('button');
    save.className = 'btn btn-primary';
    save.textContent = '저장하기';
    save.addEventListener('click', () => void this.save(posterUrl));

    const exhibit = document.createElement('button');
    exhibit.className = 'btn btn-dark';
    exhibit.textContent = '전시하기';
    exhibit.addEventListener('click', () => void this.goExhibit());

    actions.append(save, exhibit);
    screen.appendChild(actions);

    const remake = document.createElement('button');
    remake.className = 'poster-result__remake';
    remake.textContent = '영화 포스터 다시 만들기';
    remake.addEventListener('click', () => router.navigate(ROUTES.posterStyle));
    screen.appendChild(remake);

    root.appendChild(screen);
  }

  /** AR 전시로 이동. iOS는 자이로 권한을 사용자 제스처(클릭) 안에서 요청해야 함. */
  private async goExhibit(): Promise<void> {
    type DOE = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    const doe = window.DeviceOrientationEvent as DOE | undefined;
    if (doe && typeof doe.requestPermission === 'function') {
      try {
        await doe.requestPermission();
      } catch {
        /* 거부해도 자동회전/드래그 폴백으로 동작 */
      }
    }
    router.navigate(ROUTES.posterExhibit);
  }

  /** 갤러리 저장: Web Share(파일) 우선, 미지원 시 다운로드 링크. */
  private async save(dataUrl: string): Promise<void> {
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], 'bifan-poster.png', { type: 'image/png' });

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'BIFAN 30 AI 포스터' });
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bifan-poster.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      showToast('이미지를 저장했습니다.');
    } catch (err) {
      // 사용자가 공유 시트를 취소한 경우는 에러로 취급하지 않음.
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[PosterResultPage] save failed', err);
      showToast('저장에 실패했습니다.');
    }
  }

  unmount(): void {
    /* no resources */
  }
}
