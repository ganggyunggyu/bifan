import type { Page } from './Page';
import { Modal } from '../components/Modal';
import { ProgressBar } from '../components/ProgressBar';
import { createBifanLogo } from '../components/Brand';
import { preloadAll, getTotalBytes } from '../utils/assetPreloader';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';
import { DOWNLOAD_SIZE_MB, MODAL_DELAY_MS } from '../config/appConfig';

const toMB = (bytes: number): string => (bytes / (1024 * 1024)).toFixed(0);

/**
 * [Screen 1] 로딩 페이지 + 데이터 다운로드 모달
 * [Screen 2] 다운로드 프로그레스
 */
export class LoadingPage implements Page {
  private timers: number[] = [];
  private modal: Modal | null = null;
  private root!: HTMLElement;
  private cancelled = false;
  private totalBytes = 0;

  mount(root: HTMLElement): void {
    this.root = root;
    const screen = document.createElement('div');
    screen.className = 'screen screen--center loading-page';

    const logo = createBifanLogo();
    logo.classList.add('fade-in');
    screen.appendChild(logo);
    root.appendChild(screen);

    // 실제 다운로드 용량을 미리 조회(HEAD).
    void getTotalBytes().then((b) => (this.totalBytes = b));

    // 1.5초 후 다운로드 모달 자동 노출.
    this.timers.push(
      window.setTimeout(() => this.showDownloadModal(), MODAL_DELAY_MS),
    );
  }

  private showDownloadModal(): void {
    const sizeMB = this.totalBytes ? toMB(this.totalBytes) : `${DOWNLOAD_SIZE_MB}`;
    this.modal = new Modal({
      body: '콘텐츠 실행을 위해 데이터 다운로드가 필요합니다.',
      detail: `필요 데이터 ${sizeMB}MB`,
      buttons: [
        { label: '다운로드', variant: 'primary', onClick: () => this.startDownload() },
        { label: '종료하기', variant: 'dark', onClick: () => this.confirmExit() },
      ],
    });
    this.modal.mount(this.root);
  }

  private confirmExit(): void {
    this.modal?.close();
    this.modal = new Modal({
      body: '데이터를 다운로드하지 않으면\n콘텐츠를 실행할 수 없습니다.',
      buttons: [
        { label: '다운로드하기', variant: 'primary', onClick: () => this.startDownload() },
        {
          label: '종료하기',
          variant: 'dark',
          onClick: () => {
            // 사용자가 직접 연 탭이 아니면 window.close()가 무시될 수 있음.
            window.close();
          },
        },
      ],
    });
    this.modal.mount(this.root);
  }

  private startDownload(): void {
    this.modal?.close();
    this.renderProgress();
  }

  private renderProgress(): void {
    this.root.replaceChildren();
    const screen = document.createElement('div');
    screen.className = 'screen screen--center loading-page';

    screen.appendChild(createBifanLogo());

    const label = document.createElement('p');
    label.className = 'progress-label';
    screen.appendChild(label);

    const bar = new ProgressBar();
    bar.el.classList.add('progress-track--inline');
    screen.appendChild(bar.el);
    this.root.appendChild(screen);

    // 실제 바이트 기준 진행률 표시(MB).
    const update = (loadedBytes: number, totalBytes: number) => {
      const total = totalBytes || loadedBytes || 1;
      label.textContent = `데이터 다운로드 중... (${toMB(loadedBytes)}MB / ${toMB(total)}MB)`;
      bar.setProgress(loadedBytes / total);
      appState.set({ downloadProgress: loadedBytes / total });
    };
    update(0, this.totalBytes);

    // 실제 에셋(영상 등)을 전부 받아 blob으로 캐시 → 재생 중 끊김 방지.
    preloadAll(update, this.totalBytes).then(() => {
      if (this.cancelled) return; // 다운로드 중 이탈 시 잔여 네비게이션 방지.
      appState.set({ downloadComplete: true, downloadProgress: 1 });
      // 다운로드 → AR 데이터 로딩 (감사 메시지는 영상재생 뒤로 이동).
      router.navigate(ROUTES.arLoading);
    });
  }

  unmount(): void {
    this.cancelled = true;
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.modal?.close();
    this.modal = null;
  }
}
