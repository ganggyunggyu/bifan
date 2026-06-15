import type { Page } from './Page';
import { createTopBar } from '../components/TopBar';
import { GuideCarousel } from '../components/GuideCarousel';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import type { CameraFacing } from '../ar/CameraManager';
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

/**
 * [Module B — Screen 7] AI 포스터 카메라.
 * 인물 사진을 최대 4장(MAX_PEOPLE) 촬영/업로드한 뒤 스타일 선택(Screen 8)로 전환.
 * 인물수는 첨부한 사진 장수로 자동 결정됩니다.
 */
export class PosterCameraPage implements Page {
  private tracker = new ImageTargetTracker();
  private root!: HTMLElement;
  private guide: GuideCarousel | null = null;
  private video: HTMLVideoElement | null = null;
  private hasStream = false;
  private facing: CameraFacing = 'environment';
  private flipBtn: HTMLButtonElement | null = null;
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

    const galleryBtn = document.createElement('button');
    galleryBtn.className = 'poster-nav__side';
    galleryBtn.textContent = '🖼';
    galleryBtn.setAttribute('aria-label', '갤러리에서 선택');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    fileInput.addEventListener('change', () => {
      const files = fileInput.files ? Array.from(fileInput.files) : [];
      for (const f of files) this.addPhoto(f);
      fileInput.value = ''; // 같은 파일 재선택 허용
    });
    galleryBtn.addEventListener('click', () => fileInput.click());

    nav.append(helpBtn, shutter, galleryBtn, fileInput);
    screen.appendChild(nav);
    root.appendChild(screen);

    this.renderThumbs();

    // 카메라 시작 (기본 후면).
    const { video, hasStream } = await this.tracker.startCamera(this.facing);
    // 권한 대기 중 화면을 떠났다면 중단(분리된 DOM에 video를 붙이지 않도록).
    if (this.disposed) return;
    this.video = video;
    this.hasStream = hasStream;
    if (hasStream) {
      video.className = 'ar-video';
      this.applyMirror();
      view.appendChild(video);
    } else {
      view.classList.add('ar-view--placeholder');
      if (this.flipBtn) this.flipBtn.style.display = 'none'; // 카메라 없으면 전환 의미 없음
      const ph = document.createElement('p');
      ph.className = 'ar-placeholder-text';
      ph.textContent = '카메라 미리보기 (권한 없음) · 촬영 시 샘플 이미지 사용';
      view.appendChild(ph);
    }

    // 첫 진입 시 안내 모달 자동 노출.
    this.showGuide();
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

  private showGuide(): void {
    this.guide?.close();
    this.guide = new GuideCarousel({
      images: GUIDE_IMAGES,
      onClose: () => (this.guide = null),
    });
    this.guide.mount(this.root);
  }

  /** 카메라 프레임 캡처 → File. 스트림 없으면 샘플 이미지 합성. */
  private async capture(): Promise<void> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (this.hasStream && this.video && this.video.videoWidth) {
      canvas.width = this.video.videoWidth;
      canvas.height = this.video.videoHeight;
      // 전면 카메라는 미리보기와 동일하게 좌우 반전해서 캡처.
      if (this.facing === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);
    } else {
      // 샘플(권한 없음) 합성: 그라데이션 배경 + 인물 실루엣.
      canvas.width = 720;
      canvas.height = 960;
      const g = ctx.createLinearGradient(0, 0, 0, canvas.height);
      g.addColorStop(0, '#3a4a6b');
      g.addColorStop(1, '#1a2238');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(360, 380, 130, 0, Math.PI * 2); // 머리
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(360, 760, 230, 280, 0, Math.PI, 0); // 어깨
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 28px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SAMPLE', 360, 920);
    }

    await new Promise<void>((resolve) => {
      canvas.toBlob((blob) => {
        if (blob) this.addPhoto(new File([blob], 'capture.png', { type: 'image/png' }));
        resolve();
      }, 'image/png');
    });
  }

  /** 사진을 수집 목록에 추가(최대 MAX_PEOPLE장). */
  private addPhoto(file: File): void {
    if (this.photos.length >= MAX_PEOPLE) {
      showToast(`최대 ${MAX_PEOPLE}장까지 추가할 수 있어요`);
      return;
    }
    this.photos.push(file);
    this.renderThumbs();
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
    this.proceedBtn.textContent = n ? `다음 (${n}/${MAX_PEOPLE})` : '사진을 추가하세요';
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
  }
}
