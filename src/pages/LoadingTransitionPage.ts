import type { Page } from './Page';
import { ProgressBar } from '../components/ProgressBar';
import { createBifanLogo } from '../components/Brand';
import { simulateDownload } from '../utils/assetDownloader';
import { router } from '../utils/router';

/**
 * 범용 전환 로딩 페이지.
 * 실제 로드할 데이터가 없어도 지정 시간 동안 로딩 UI를 보여준 뒤 다음 화면으로
 * 이동합니다. (예: 30주년 메시지 → 3초 로딩 → 포스터 제작)
 */
export interface LoadingTransitionOptions {
  /** 표시 문구. */
  label: string;
  /** 로딩 지속 시간(ms). */
  durationMs: number;
  /** 완료 후 이동할 라우트. */
  next: string;
}

export class LoadingTransitionPage implements Page {
  private opts: LoadingTransitionOptions;
  private cancelled = false;

  constructor(opts: LoadingTransitionOptions) {
    this.opts = opts;
  }

  mount(root: HTMLElement): void {
    const screen = document.createElement('div');
    screen.className = 'screen screen--center loading-page';

    screen.appendChild(createBifanLogo());

    const label = document.createElement('p');
    label.className = 'progress-label';
    label.textContent = this.opts.label;
    screen.appendChild(label);

    const bar = new ProgressBar();
    bar.el.classList.add('progress-track--inline');
    screen.appendChild(bar.el);
    root.appendChild(screen);

    // 0→100% 진행을 지정 시간 동안 시뮬레이션.
    simulateDownload(100, this.opts.durationMs, (loaded, total) =>
      bar.setProgress(loaded / total),
    ).then(() => {
      if (!this.cancelled) router.navigate(this.opts.next);
    });
  }

  unmount(): void {
    this.cancelled = true;
  }
}
