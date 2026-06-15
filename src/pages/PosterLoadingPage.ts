import type { Page } from './Page';
import { ProgressBar } from '../components/ProgressBar';
import { showToast } from '../components/Toast';
import { generatePoster, compressImage, buildPromptRequest } from '../api/posterGenerate';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/**
 * [Module B — Screen 9] 포스터 생성 로딩.
 * AI 생성 API(현재 placeholder) 호출 → 성공 시 완료 화면, 실패 시 재시도.
 */
export class PosterLoadingPage implements Page {
  private cancelled = false;

  mount(root: HTMLElement): void {
    const photos = appState.get().capturedPhotos;
    if (!photos.length) {
      router.navigate(ROUTES.poster);
      return;
    }

    const screen = document.createElement('div');
    screen.className = 'screen screen--center poster-loading-page';

    const title = document.createElement('h1');
    title.className = 'poster-loading__title';
    title.textContent = '포스터 생성중';

    const sub = document.createElement('p');
    sub.className = 'poster-loading__sub';
    sub.textContent = '디자이너가 열심히 작업하는 중입니다...';

    const bar = new ProgressBar(true); // indeterminate
    bar.el.classList.add('progress-track--inline');

    screen.append(title, sub, bar.el);
    root.appendChild(screen);

    void this.run(photos, screen, sub);
  }

  private async run(
    photos: File[],
    screen: HTMLElement,
    sub: HTMLElement,
  ): Promise<void> {
    try {
      // 원본이 크면 본문 한도를 넘기므로 각 사진을 축소+JPEG 압축 후 전송.
      const images = await Promise.all(photos.map((p) => compressImage(p)));
      const req = buildPromptRequest(images, appState.get());
      const res = await generatePoster(req);
      if (this.cancelled) return;
      appState.set({ generatedPosterUrl: res.imageUrl });
      router.navigate(ROUTES.posterResult);
    } catch (err) {
      if (this.cancelled) return;
      console.error('[PosterLoadingPage] generate failed', err);
      showToast('포스터 생성에 실패했습니다. 다시 시도해주세요.');
      sub.textContent = '생성에 실패했습니다.';
      const retry = document.createElement('button');
      retry.className = 'btn btn-primary poster-loading__retry';
      retry.textContent = '다시 시도';
      retry.addEventListener('click', () => void this.run(photos, screen, sub));
      screen.appendChild(retry);
    }
  }

  unmount(): void {
    this.cancelled = true;
  }
}
