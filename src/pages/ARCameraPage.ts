import type { Page } from './Page';
import { GuideFrame } from '../components/GuideFrame';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { EighthWallController, type ImageTargetDetail } from '../ar/EighthWallController';
import { PropAnimationPlayer } from '../ar/PropAnimationPlayer';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';
import { TARGET_HOLD_MS } from '../config/appConfig';
import {
  ENABLE_IMAGE_TARGET,
  STRUCTURE_TARGET,
  MODULE_A_VIDEO,
} from '../config/arConfig';

/**
 * [Module A — Screen 5] AR 카메라 (구조물 인식)
 *
 * 인식 로직:
 *   onFound → 가이드라인 초록 + TARGET_HOLD_MS(3초) 타이머 시작
 *   onLost  → 타이머 리셋 + 가이드라인 빨강 복귀
 *   3초 유지 → 영상 재생 트리거
 *
 * 두 가지 모드:
 *  1) 8th Wall 이미지 타겟(ENABLE_IMAGE_TARGET) — 실제 구조물 인식.
 *     인식된 벽면 pose/크기에 영상을 앵커링해 **벽면 위에서 그대로 재생**.
 *  2) 폴백(기본) — 카메라 피드 + 가이드 + [시뮬레이션] 버튼으로 트리거,
 *     3초 유지 시 전체화면 영상 화면(/ar-animation)으로 전환.
 */
export class ARCameraPage implements Page {
  private tracker = new ImageTargetTracker();
  private guide = new GuideFrame();
  private holdTimer: number | null = null;
  private triggered = false;
  private disposed = false;
  private hint!: HTMLParagraphElement;

  // 8th Wall 이미지 타겟 모드.
  private eighthWall = new EighthWallController();
  private player: PropAnimationPlayer | null = null;
  private imageTargetMode = false;
  private onXrFound = (e: Event) => this.onImageEvent('found', e);
  private onXrUpdated = (e: Event) => this.onImageEvent('updated', e);
  private onXrLost = (e: Event) => this.onImageEvent('lost', e);

  async mount(root: HTMLElement): Promise<void> {
    const screen = document.createElement('div');
    screen.className = 'screen ar-camera-page';

    const view = document.createElement('div');
    view.className = 'ar-view';
    screen.appendChild(view);

    screen.appendChild(this.guide.el);

    this.hint = document.createElement('p');
    this.hint.className = 'ar-hint';
    this.hint.textContent = '사물을 해당 영역에 맞춰주세요';
    screen.appendChild(this.hint);

    root.appendChild(screen);

    // 1) 8th Wall 이미지 타겟 모드 시도.
    if (ENABLE_IMAGE_TARGET) {
      this.hint.textContent = 'AR 엔진 로딩 중...';
      const canvas = document.createElement('canvas');
      canvas.className = 'ar-canvas';
      view.appendChild(canvas);
      const ok = await this.startImageTargetMode(canvas);
      if (ok) {
        this.imageTargetMode = true;
        this.hint.textContent = '구조물을 화면 영역에 맞춰주세요';
        return;
      }
      canvas.remove();
    }

    // 2) 폴백: 카메라 피드 + 시뮬레이션 버튼.
    this.startMockMode(view, screen);
  }

  // ---------- 8th Wall 이미지 타겟 모드 ----------

  private async startImageTargetMode(canvas: HTMLCanvasElement): Promise<boolean> {
    this.player = new PropAnimationPlayer(MODULE_A_VIDEO, {
      onEnded: () => router.navigate(ROUTES.messageIntro),
      onError: () => router.navigate(ROUTES.messageIntro),
    });

    const ok = await this.eighthWall.startImageTarget({
      canvas,
      targetName: STRUCTURE_TARGET.name,
      onSceneReady: ({ scene }) => this.player?.attachToEighthWall(scene),
      onError: () => undefined,
    });
    // AR 세션 준비 중 페이지를 떠났다면 방금 만든 세션/플레이어를 즉시 정리.
    if (!ok || this.disposed) {
      this.player.dispose();
      this.player = null;
      if (this.disposed) this.eighthWall.stop();
      return false;
    }

    window.addEventListener('xrimagefound', this.onXrFound);
    window.addEventListener('xrimageupdated', this.onXrUpdated);
    window.addEventListener('xrimagelost', this.onXrLost);
    return true;
  }

  private onImageEvent(kind: 'found' | 'updated' | 'lost', e: Event): void {
    const detail = (e as CustomEvent<ImageTargetDetail>).detail;
    if (!detail || detail.name !== STRUCTURE_TARGET.name) return;

    if (kind === 'lost') {
      this.onLost();
      return;
    }

    // 인식된 벽면 pose/크기에 영상 plane을 앵커링(벽면 크기로 붙음).
    this.player?.updateAnchorPose(
      detail.position,
      detail.rotation,
      detail.scaledWidth ?? STRUCTURE_TARGET.physicalWidthMeters,
    );
    this.onFound();
  }

  // ---------- 폴백(mock) 모드 ----------

  private async startMockMode(view: HTMLElement, screen: HTMLElement): Promise<void> {
    this.hint.textContent = '사물을 해당 영역에 맞춰주세요';

    const devBtn = document.createElement('button');
    devBtn.className = 'ar-dev-toggle';
    devBtn.textContent = '시뮬레이션: 인식';
    let found = false;
    devBtn.addEventListener('click', () => {
      found = !found;
      devBtn.textContent = found ? '시뮬레이션: 소실' : '시뮬레이션: 인식';
      if (found) this.tracker.mockFound();
      else this.tracker.mockLost();
    });
    screen.appendChild(devBtn);

    this.tracker.on('found', () => this.onFound());
    this.tracker.on('lost', () => this.onLost());

    const { video, hasStream } = await this.tracker.startCamera();
    if (this.disposed) return;
    if (hasStream) {
      video.className = 'ar-video';
      view.appendChild(video);
    } else {
      view.classList.add('ar-view--placeholder');
      const ph = document.createElement('p');
      ph.className = 'ar-placeholder-text';
      ph.textContent = '카메라 미리보기 (권한 없음)';
      view.appendChild(ph);
    }
  }

  // ---------- 공통 인식 로직 ----------

  private onFound(): void {
    this.guide.setFound(true);
    appState.set({ isTargetFound: true });
    if (this.holdTimer !== null || this.triggered) return;
    this.holdTimer = window.setTimeout(() => this.onHoldComplete(), TARGET_HOLD_MS);
  }

  private onLost(): void {
    this.guide.setFound(false);
    appState.set({ isTargetFound: false });
    if (this.holdTimer !== null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  private onHoldComplete(): void {
    this.triggered = true;
    this.holdTimer = null;

    if (this.imageTargetMode && this.player) {
      // 벽면에 앵커된 영상 재생(같은 AR 세션 내). 종료 시 onEnded → 메시지.
      this.guide.el.style.display = 'none';
      this.hint.textContent = '';
      void this.player.play();
    } else {
      // 폴백: 전체화면 영상 화면으로 전환.
      router.navigate(ROUTES.arAnimation);
    }
  }

  unmount(): void {
    this.disposed = true;
    if (this.holdTimer !== null) clearTimeout(this.holdTimer);
    this.holdTimer = null;
    window.removeEventListener('xrimagefound', this.onXrFound);
    window.removeEventListener('xrimageupdated', this.onXrUpdated);
    window.removeEventListener('xrimagelost', this.onXrLost);
    this.player?.dispose();
    this.player = null;
    this.eighthWall.stop();
    this.tracker.stop();
  }
}
