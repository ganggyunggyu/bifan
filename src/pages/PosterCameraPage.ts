import type { Page } from './Page';
import { createTopBar } from '../components/TopBar';
import { GuideCarousel } from '../components/GuideCarousel';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { cameraManager, type CameraFacing } from '../ar/CameraManager';
import { showToast } from '../components/Toast';
import { MAX_PEOPLE } from '../config/posterOptions';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/** 체험 방법 안내 4단계 (디자인된 풀카드 이미지, 순서 유의). */
const GUIDE_IMAGES = [
  '/assets/guide/step1.png',
  '/assets/guide/step2.png',
  '/assets/guide/step3.png',
  '/assets/guide/step4.png',
];

const CAPTURE_MAX_EDGE = 1280;
const CAPTURE_MIME_TYPE = 'image/jpeg';
const CAPTURE_QUALITY = 0.86;
const GUIDE_AUTOSHOW_STORAGE_KEY = 'bifan.moduleB.guide.seen';
const GUIDE_AUTOSHOW_LEGACY_STORAGE_KEYS = ['bifan.moduleB.guide.v3.seen'];

/**
 * [Module B — Screen 7] AI 포스터 카메라.
 * 인물 사진 1장을 촬영/업로드하면 바로 스타일 선택(Screen 8)로 전환합니다.
 */
export class PosterCameraPage implements Page {
  private tracker = new ImageTargetTracker();
  private root!: HTMLElement;
  private guide: GuideCarousel | null = null;
  private video: HTMLVideoElement | null = null;
  private hasStream = false;
  private facing: CameraFacing = 'user';
  private cameraView: HTMLElement | null = null;
  private flipBtn: HTMLButtonElement | null = null;
  private shutterBtn: HTMLButtonElement | null = null;
  private nativeCaptureInput: HTMLInputElement | null = null;
  private capturing = false;
  private disposed = false;

  // 다중 사진 수집 상태.
  private photos: File[] = [];
  private thumbUrls: string[] = [];
  private thumbStrip!: HTMLElement;
  private proceedBtn!: HTMLButtonElement;

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    const screen = document.createElement('div');
    screen.className = 'screen poster-camera-page';

    screen.appendChild(
      createTopBar({
        title: '나만의 영화포스터를 만들어 보세요',
        onBack: () => router.navigate(ROUTES.loading),
        onHelp: () => this.showGuide(),
      }),
    );

    const view = document.createElement('div');
    view.className = 'ar-view poster-view';
    screen.appendChild(view);
    this.cameraView = view;

    // 전/후면 전환 버튼 (카메라 뷰 우상단).
    const flip = document.createElement('button');
    flip.className = 'poster-flip';
    flip.textContent = '🔄';
    flip.setAttribute('aria-label', '전/후면 카메라 전환');
    flip.addEventListener('click', () => void this.flipCamera());
    view.appendChild(flip);
    this.flipBtn = flip;

    // 수집된 사진 썸네일 + 다음 버튼 바.
    const bar = document.createElement('div');
    bar.className = 'poster-capture-bar';

    this.thumbStrip = document.createElement('div');
    this.thumbStrip.className = 'poster-thumbs';
    bar.appendChild(this.thumbStrip);

    this.proceedBtn = document.createElement('button');
    this.proceedBtn.className = 'btn btn-primary poster-proceed';
    this.proceedBtn.addEventListener('click', () => this.proceed());
    bar.appendChild(this.proceedBtn);
    screen.appendChild(bar);

    // 하단 네비게이션 바: ? / 촬영 / 갤러리
    const nav = document.createElement('div');
    nav.className = 'poster-nav';

    const helpBtn = document.createElement('button');
    helpBtn.className = 'poster-nav__side';
    helpBtn.textContent = '?';
    helpBtn.setAttribute('aria-label', '체험 방법 안내');
    helpBtn.addEventListener('click', () => this.showGuide());

    const shutter = document.createElement('button');
    shutter.className = 'poster-nav__shutter';
    shutter.setAttribute('aria-label', '촬영');
    shutter.addEventListener('click', () => void this.capture());
    this.shutterBtn = shutter;

    const galleryBtn = document.createElement('button');
    galleryBtn.className = 'poster-nav__side';
    galleryBtn.textContent = '🖼';
    galleryBtn.setAttribute('aria-label', '갤러리에서 선택');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = false;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const files = fileInput.files ? Array.from(fileInput.files) : [];
      const file = files[0];
      if (file) this.addPhoto(file);
      fileInput.value = ''; // 같은 파일 재선택 허용
    });
    galleryBtn.addEventListener('click', () => fileInput.click());

    const nativeCaptureInput = document.createElement('input');
    nativeCaptureInput.type = 'file';
    nativeCaptureInput.accept = 'image/*';
    nativeCaptureInput.setAttribute('capture', 'user');
    nativeCaptureInput.style.display = 'none';
    nativeCaptureInput.addEventListener('change', () => {
      const files = nativeCaptureInput.files ? Array.from(nativeCaptureInput.files) : [];
      const file = files[0];
      if (file) this.addPhoto(file);
      nativeCaptureInput.value = '';
    });
    this.nativeCaptureInput = nativeCaptureInput;

    nav.append(helpBtn, shutter, galleryBtn, fileInput, nativeCaptureInput);
    screen.appendChild(nav);
    root.appendChild(screen);

    this.renderThumbs();
    this.showGuideOnce();

    // 첫 플로우에서 이미 카메라 권한을 받은 경우에는 포스터 화면에서 바로 전면 카메라를 붙입니다.
    void this.startCameraIfAlreadyAllowed();
  }

  private async startCameraIfAlreadyAllowed(): Promise<void> {
    if (this.disposed) return;

    if (cameraManager.active) {
      await this.startCameraPreview();
      return;
    }

    const permission = await this.queryCameraPermission();
    if (this.disposed) return;

    if (permission === 'granted') {
      await this.startCameraPreview();
      return;
    }

    this.showCameraStartUi();
  }

  private async queryCameraPermission(): Promise<PermissionState | null> {
    return cameraManager.permissionState();
  }

  private async startCameraPreview(): Promise<void> {
    const view = this.cameraView;
    if (!view) return;

    this.setCameraPendingUi();
    this.tracker.stop();

    const { video, hasStream } = await this.tracker.startCamera(this.facing);
    if (this.disposed) return;

    this.video = video;
    this.hasStream = hasStream;
    view.replaceChildren();
    view.appendChild(this.flipBtn!);

    if (hasStream) {
      view.classList.remove('ar-view--placeholder');
      if (this.flipBtn) this.flipBtn.style.display = '';
      video.className = 'ar-video';
      this.applyMirror();
      view.appendChild(video);
      return;
    }

    this.showCameraPermissionUi();
  }

  private setCameraPendingUi(): void {
    const view = this.cameraView;
    if (!view) return;
    view.classList.add('ar-view--placeholder');
    view.replaceChildren();
    if (this.flipBtn) {
      this.flipBtn.style.display = 'none';
      view.appendChild(this.flipBtn);
    }
    const ph = document.createElement('p');
    ph.className = 'ar-placeholder-text';
    ph.textContent = '카메라 연결 중';
    view.appendChild(ph);
  }

  private showCameraStartUi(): void {
    this.showCameraPermissionUi({
      body: '전면 카메라로 촬영을 시작합니다.',
      primaryLabel: '카메라 시작',
      title: '카메라를 켜주세요',
    });
  }

  private showCameraPermissionUi(copy: {
    body: string;
    primaryLabel: string;
    title: string;
  } = {
    body: '권한을 허용하거나 바로 사진을 선택해 주세요.',
    primaryLabel: '카메라 허용',
    title: '카메라 권한이 꺼져 있습니다',
  }): void {
    const view = this.cameraView;
    if (!view) return;
    view.classList.add('ar-view--placeholder');
    view.replaceChildren();
    if (this.flipBtn) this.flipBtn.style.display = 'none';
    if (this.flipBtn) view.appendChild(this.flipBtn);

    const panel = document.createElement('div');
    panel.className = 'poster-permission-panel';

    const title = document.createElement('strong');
    title.textContent = copy.title;
    const body = document.createElement('span');
    body.textContent = copy.body;

    const actions = document.createElement('div');
    actions.className = 'poster-permission-actions';

    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-primary';
    retry.textContent = copy.primaryLabel;
    retry.addEventListener('click', () => void this.startCameraPreview());

    const capture = document.createElement('button');
    capture.type = 'button';
    capture.className = 'btn btn-secondary';
    capture.textContent = '사진 선택';
    capture.addEventListener('click', () => this.nativeCaptureInput?.click());

    actions.append(retry, capture);
    panel.append(title, body, actions);
    view.appendChild(panel);
  }

  /** 전/후면 전환. 전면일 때는 셀카처럼 미리보기를 좌우 반전. */
  private async flipCamera(): Promise<void> {
    if (!this.hasStream) return;
    const next: CameraFacing = this.facing === 'environment' ? 'user' : 'environment';
    const ok = await this.tracker.switchCamera(next);
    if (ok) {
      this.facing = next;
      this.applyMirror();
    }
  }

  /** 전면 카메라일 때 미리보기 좌우 반전(자연스러운 셀카 느낌). */
  private applyMirror(): void {
    this.video?.classList.toggle('ar-video--mirror', this.facing === 'user');
  }

  private showGuide(onShown?: () => void): void {
    this.guide?.close();
    this.guide = new GuideCarousel({
      images: GUIDE_IMAGES,
      onClose: () => (this.guide = null),
    });
    this.guide.mount(this.root);
    onShown?.();
  }

  private showGuideOnce(): void {
    if (this.hasSeenInitialGuide()) return;
    window.setTimeout(() => {
      if (this.disposed || this.hasSeenInitialGuide()) return;
      this.showGuide(() => {
        this.markInitialGuideSeen();
        document.documentElement.dataset.moduleBGuideAuto = 'shown';
      });
    }, 120);
  }

  private hasSeenInitialGuide(): boolean {
    const globalState = window as Window & {
      __bifanModuleBGuideSeen?: Record<string, boolean>;
    };
    if (this.storageKeys.some((key) => globalState.__bifanModuleBGuideSeen?.[key])) return true;
    try {
      const seen = this.storageKeys.some(
        (key) => window.localStorage.getItem(key) === 'true',
      );
      if (seen) this.markInitialGuideSeen();
      return seen;
    } catch {
      return false;
    }
  }

  private markInitialGuideSeen(): void {
    const globalState = window as Window & {
      __bifanModuleBGuideSeen?: Record<string, boolean>;
    };
    globalState.__bifanModuleBGuideSeen = {
      ...globalState.__bifanModuleBGuideSeen,
      [GUIDE_AUTOSHOW_STORAGE_KEY]: true,
    };
    this.storageKeys.forEach((key) => {
      globalState.__bifanModuleBGuideSeen![key] = true;
    });
    try {
      this.storageKeys.forEach((key) => {
        window.localStorage.setItem(key, 'true');
      });
    } catch {
      /* storage may be unavailable in private/in-app contexts */
    }
  }

  private get storageKeys(): string[] {
    return [GUIDE_AUTOSHOW_STORAGE_KEY, ...GUIDE_AUTOSHOW_LEGACY_STORAGE_KEYS];
  }

  /** 카메라 프레임 캡처 → File. 스트림 없으면 샘플 이미지 합성. */
  private async capture(): Promise<void> {
    if (this.capturing) return;

    if (!this.hasStream) {
      this.nativeCaptureInput?.click();
      return;
    }

    this.capturing = true;
    if (this.shutterBtn) {
      this.shutterBtn.disabled = true;
      this.shutterBtn.setAttribute('aria-busy', 'true');
    }

    try {
      const file = await this.captureFrame();
      if (file) this.addPhoto(file);
    } finally {
      this.capturing = false;
      if (this.shutterBtn && !this.disposed) {
        this.shutterBtn.disabled = false;
        this.shutterBtn.removeAttribute('aria-busy');
      }
    }
  }

  private async captureFrame(): Promise<File | null> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    if (this.hasStream && this.video && this.video.videoWidth) {
      const sourceWidth = this.video.videoWidth;
      const sourceHeight = this.video.videoHeight;
      const scale = Math.min(1, CAPTURE_MAX_EDGE / Math.max(sourceWidth, sourceHeight));
      canvas.width = Math.max(1, Math.round(sourceWidth * scale));
      canvas.height = Math.max(1, Math.round(sourceHeight * scale));
      // 전면 카메라는 미리보기와 동일하게 좌우 반전해서 캡처.
      if (this.facing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    } else {
      this.nativeCaptureInput?.click();
      return null;
    }

    return new Promise<File | null>((resolve) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], 'capture.jpg', { type: CAPTURE_MIME_TYPE, lastModified: Date.now() }));
      }, CAPTURE_MIME_TYPE, CAPTURE_QUALITY);
    });
  }

  /** 사진을 수집 목록에 추가(최대 MAX_PEOPLE장). */
  private addPhoto(file: File): void {
    if (this.photos.length >= MAX_PEOPLE) {
      showToast('사진은 1장만 사용할 수 있어요');
      return;
    }
    this.photos.push(file);
    this.renderThumbs();
    if (this.photos.length >= MAX_PEOPLE) {
      this.proceed();
    }
  }

  private removePhoto(index: number): void {
    this.photos.splice(index, 1);
    this.renderThumbs();
  }

  /** 썸네일 스트립 + 다음 버튼 갱신. */
  private renderThumbs(): void {
    // 이전 objectURL 정리(누수 방지).
    this.thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    this.thumbUrls = [];
    this.thumbStrip.replaceChildren();

    this.photos.forEach((file, i) => {
      const url = URL.createObjectURL(file);
      this.thumbUrls.push(url);

      const thumb = document.createElement('div');
      thumb.className = 'poster-thumb';

      const img = document.createElement('img');
      img.src = url;
      img.alt = `선택한 사진 ${i + 1}`;
      thumb.appendChild(img);

      const remove = document.createElement('button');
      remove.className = 'poster-thumb__remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `사진 ${i + 1} 삭제`);
      remove.addEventListener('click', () => this.removePhoto(i));
      thumb.appendChild(remove);

      this.thumbStrip.appendChild(thumb);
    });

    const n = this.photos.length;
    this.proceedBtn.textContent = n ? '다음' : '사진을 추가하세요';
    this.proceedBtn.disabled = n === 0;
  }

  private proceed(): void {
    if (!this.photos.length) return;
    appState.set({ capturedPhotos: [...this.photos] });
    router.navigate(ROUTES.posterStyle);
  }

  unmount(): void {
    this.disposed = true;
    this.thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    this.thumbUrls = [];
    this.guide?.close();
    this.guide = null;
    this.tracker.stop();
    this.video = null;
    this.shutterBtn = null;
    this.nativeCaptureInput = null;
    this.cameraView = null;
  }
}
