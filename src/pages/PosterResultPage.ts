import type { Page } from './Page';
import { showToast } from '../components/Toast';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

const POSTER_FILENAME = 'bifan-poster.png';
const POSTER_FILE_TYPE = 'image/png';

interface PreparedPosterFile {
  blob: Blob;
  file: File;
}

/**
 * [Module B — Screen 10] 포스터 생성 완료.
 * 저장하기 / 전시하기 / 다시 만들기.
 */
export class PosterResultPage implements Page {
  private preparedPoster: PreparedPosterFile | null = null;
  private saveButton: HTMLButtonElement | null = null;
  private preparing = false;
  private saving = false;

  mount(root: HTMLElement): void {
    const state = appState.get();
    const posterUrl = state.generatedPosterUrl;
    if (!posterUrl) {
      router.navigate(ROUTES.poster);
      return;
    }

    const screen = document.createElement('div');
    screen.className = 'screen poster-result-page scrollable';
    screen.dataset.posterSource = state.generatedPosterSource ?? '';
    screen.dataset.posterInputCount = String(state.generatedPosterInputCount);

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
    save.textContent = '저장 준비중';
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
    save.addEventListener('click', () => void this.save());
    this.saveButton = save;
    void this.prepareSaveFile(posterUrl);

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

  private async prepareSaveFile(dataUrl: string): Promise<void> {
    this.preparing = true;
    try {
      this.preparedPoster = await this.buildPosterFile(dataUrl);
      this.setSaveReady();
    } catch (err) {
      console.error('[PosterResultPage] prepare save file failed', err);
      this.setSaveReady('다운로드 저장');
      showToast('저장 준비에 실패했습니다.');
    } finally {
      this.preparing = false;
    }
  }

  private async buildPosterFile(dataUrl: string): Promise<PreparedPosterFile> {
    const blob = await (await fetch(dataUrl)).blob();
    const posterBlob = blob.type ? blob : new Blob([blob], { type: POSTER_FILE_TYPE });
    const file = new File([posterBlob], POSTER_FILENAME, {
      type: posterBlob.type || POSTER_FILE_TYPE,
      lastModified: Date.now(),
    });
    return { blob: posterBlob, file };
  }

  private setSaveReady(label = '갤러리에 저장'): void {
    if (!this.saveButton) return;
    this.saveButton.textContent = label;
    this.saveButton.disabled = false;
    this.saveButton.removeAttribute('aria-busy');
  }

  /** 갤러리 저장: 모바일 네이티브 파일 저장 시트 우선, 미지원 시 다운로드 링크. */
  private async save(): Promise<void> {
    if (this.saving) return;

    const prepared = this.preparedPoster;
    if (!prepared) {
      showToast(this.preparing ? '이미지 저장 준비 중입니다.' : '저장할 이미지를 찾지 못했습니다.');
      return;
    }

    this.saving = true;
    this.saveButton?.setAttribute('aria-busy', 'true');
    try {
      if (this.canUseNativeFileShare(prepared.file)) {
        try {
          await navigator.share({
            files: [prepared.file],
            title: 'BIFAN 30 AI 포스터',
          });
          showToast('갤러리 저장 화면을 열었습니다.');
          return;
        } catch (shareErr) {
          if ((shareErr as Error)?.name === 'AbortError') return;
          console.warn('[PosterResultPage] native share unavailable, falling back to download', shareErr);
        }
      }

      this.downloadBlob(prepared.blob);
      showToast(this.isTouchDevice() ? '다운로드로 저장했습니다.' : '이미지를 다운로드했습니다.');
    } catch (err) {
      // 사용자가 공유 시트를 취소한 경우는 에러로 취급하지 않음.
      if ((err as Error)?.name === 'AbortError') return;
      console.error('[PosterResultPage] save failed', err);
      showToast('저장에 실패했습니다.');
    } finally {
      this.saving = false;
      this.saveButton?.removeAttribute('aria-busy');
    }
  }

  private canUseNativeFileShare(file: File): boolean {
    if (!window.isSecureContext || typeof navigator.share !== 'function') return false;
    if (typeof navigator.canShare !== 'function') return true;
    return navigator.canShare({ files: [file] });
  }

  private isTouchDevice(): boolean {
    return navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches;
  }

  private downloadBlob(blob: Blob): void {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = POSTER_FILENAME;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  unmount(): void {
    /* no resources */
  }
}
