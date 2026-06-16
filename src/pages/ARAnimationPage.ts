import * as THREE from 'three';
import type { Page } from './Page';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { PropAnimationPlayer } from '../ar/PropAnimationPlayer';
import { SkyAnchorModelPlayer } from '../ar/SkyAnchorModelPlayer';
import { showToast } from '../components/Toast';
import { router, ROUTES } from '../utils/router';
import { MODULE_A_VIDEO, POST_VIDEO_PROPS_HOLD_MS } from '../config/arConfig';

/**
 * [Module A — Screen 6] 3D 프랍 애니메이션 재생 (FS-003).
 *
 * 인식된 구조물 위치에 mp4 영상을 AR 앵커링하여 재생합니다.
 * 8th Wall 앱 키/이미지 타겟이 준비되면 8th Wall 모드로 동작하고,
 * 그 전까지는 dev 프리뷰 모드(카메라 피드 위 영상 plane 오버레이)로 검증합니다.
 *
 * 재생 종료 → sky-anchor 프랍 GLB 표시 → 페이드아웃 → 감사 메시지.
 */
export class ARAnimationPage implements Page {
  private tracker = new ImageTargetTracker();
  private player: PropAnimationPlayer | null = null;
  private propsPlayer: SkyAnchorModelPlayer | null = null;
  private propsRenderer: THREE.WebGLRenderer | null = null;
  private propsScene: THREE.Scene | null = null;
  private propsCamera: THREE.PerspectiveCamera | null = null;
  private propsStage: HTMLElement | null = null;
  private propsRafId = 0;
  private propsLastTime = 0;
  private propsStarted = false;
  private resizePropsBound = () => this.resizeProps();
  private root!: HTMLElement;
  private disposed = false;
  private endTimer: number | null = null;

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    const screen = document.createElement('div');
    screen.className = 'screen ar-animation-page';
    screen.dataset.phase = 'video';

    // 카메라 뷰 레이어 (8th Wall이면 XR8가 이 위에 렌더; dev면 getUserMedia 피드).
    const view = document.createElement('div');
    view.className = 'ar-view';
    screen.appendChild(view);

    // Three.js 영상 plane이 올라갈 오버레이 컨테이너.
    const stage = document.createElement('div');
    stage.className = 'ar-stage';
    screen.appendChild(stage);
    this.propsStage = stage;

    root.appendChild(screen);

    // 카메라 피드.
    const { video, hasStream } = await this.tracker.startCamera();
    // 카메라 권한 대기 중 다른 화면으로 이동했다면 여기서 중단(고아 플레이어 방지).
    if (this.disposed) return;
    if (hasStream) {
      video.className = 'ar-video';
      view.appendChild(video);
    } else {
      view.classList.add('ar-view--placeholder');
    }

    // 영상 플레이어 (dev 프리뷰 모드).
    this.player = new PropAnimationPlayer(MODULE_A_VIDEO, {
      onEnded: () => void this.onAnimationEnded(),
      onError: (err) => {
        console.error('[ARAnimationPage] video error', err);
        showToast('애니메이션을 재생할 수 없습니다.');
        void this.onAnimationEnded();
      },
    });

    // TODO(8th Wall): XR8 준비 시 attachToEighthWall(scene) + updateAnchorPose로 교체.
    this.player.mountPreview(stage);
    void this.player.play();
  }

  private async onAnimationEnded(): Promise<void> {
    if (this.disposed || this.propsStarted) return;
    this.propsStarted = true;
    this.setPhase('props-loading');

    this.player?.dispose();
    this.player = null;

    if (!this.propsStage) {
      this.navigateToMessage();
      return;
    }

    this.initPropsScene(this.propsStage);

    try {
      await this.propsPlayer?.load();
      if (this.disposed) return;
      this.propsPlayer?.reveal(true);
      this.setPhase('props');
      this.endTimer = window.setTimeout(
        () => this.navigateToMessage(),
        POST_VIDEO_PROPS_HOLD_MS,
      );
    } catch (err) {
      console.error('[ARAnimationPage] post-video props failed', err);
      this.navigateToMessage();
    }
  }

  private initPropsScene(stage: HTMLElement): void {
    if (this.propsRenderer) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      65,
      stage.clientWidth / stage.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(stage.clientWidth, stage.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'ar-canvas';
    stage.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight('#ffffff', 1.35));
    const key = new THREE.DirectionalLight('#ffffff', 2.0);
    key.position.set(-3, 5, 4);
    scene.add(key);

    this.propsPlayer = new SkyAnchorModelPlayer();
    this.propsPlayer.attachToScene(scene);

    this.propsScene = scene;
    this.propsCamera = camera;
    this.propsRenderer = renderer;

    window.addEventListener('resize', this.resizePropsBound);
    this.renderPropsLoop(0);
  }

  private renderPropsLoop = (timeMs: number): void => {
    this.propsRafId = requestAnimationFrame(this.renderPropsLoop);
    if (!this.propsRenderer || !this.propsScene || !this.propsCamera) return;

    const time = timeMs / 1000;
    const delta = this.propsLastTime > 0
      ? Math.min(Math.max(time - this.propsLastTime, 1 / 120), 1 / 24)
      : 1 / 60;
    this.propsLastTime = time;
    this.propsPlayer?.update(delta, time);
    this.propsRenderer.render(this.propsScene, this.propsCamera);
  };

  private resizeProps(): void {
    if (!this.propsRenderer || !this.propsCamera) return;
    const parent = this.propsRenderer.domElement.parentElement;
    if (!parent) return;
    this.propsCamera.aspect = parent.clientWidth / parent.clientHeight;
    this.propsCamera.updateProjectionMatrix();
    this.propsRenderer.setSize(parent.clientWidth, parent.clientHeight);
  }

  private navigateToMessage(): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) {
      screen.dataset.phase = 'fading';
      screen.classList.add('is-fading');
    }
    this.endTimer = window.setTimeout(() => router.navigate(ROUTES.messageIntro), 700);
  }

  private setPhase(phase: string): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) screen.dataset.phase = phase;
  }

  unmount(): void {
    this.disposed = true;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.player?.dispose();
    this.player = null;
    this.propsPlayer?.dispose();
    this.propsPlayer = null;
    cancelAnimationFrame(this.propsRafId);
    window.removeEventListener('resize', this.resizePropsBound);
    this.propsRenderer?.dispose();
    this.propsRenderer?.domElement.remove();
    this.propsRenderer = null;
    this.propsScene = null;
    this.propsCamera = null;
    this.propsStage = null;
    this.tracker.stop();
  }
}
