import type { Page } from './Page';
import { ProgressBar } from '../components/ProgressBar';
import { createBifanLogo } from '../components/Brand';
import { preloadAll, isPreloaded } from '../utils/assetPreloader';
import { router, ROUTES } from '../utils/router';

/**
 * [Screen 4] AR 데이터 로딩.
 * 실제 에셋은 시작 화면에서 이미 사전 다운로드되므로, 여기서는 준비 완료를
 * 보장하고 짧게 로딩 표시만 합니다(가짜 용량 표시 제거).
 */
export class DataLoadingPage implements Page {
  private cancelled = false;

  mount(root: HTMLElement): void {
    const screen = document.createElement('div');
    screen.className = 'screen screen--center loading-page';

    screen.appendChild(createBifanLogo());

    const label = document.createElement('p');
    label.className = 'progress-label';
    label.textContent = 'AR 콘텐츠 준비 중...';
    screen.appendChild(label);

    const bar = new ProgressBar(true); // indeterminate
    bar.el.classList.add('progress-track--inline');
    screen.appendChild(bar.el);
    root.appendChild(screen);

    // 에셋이 아직이면 마저 받고, 이미 받았으면 즉시 완료. 최소 0.8s 표시.
    const ready = isPreloaded() ? Promise.resolve() : preloadAll(() => undefined);
    const minDelay = new Promise((r) => setTimeout(r, 800));
    void Promise.all([ready, minDelay]).then(() => {
      if (!this.cancelled) router.navigate(ROUTES.arAnimation);
    });
  }

  unmount(): void {
    this.cancelled = true;
  }
}
