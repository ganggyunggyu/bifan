import * as THREE from 'three';
import type { Page } from './Page';
import { createTopBar } from '../components/TopBar';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { EighthWallController } from '../ar/EighthWallController';
import { PosterExhibitManager } from '../ar/PosterExhibitManager';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/**
 * [Module B — Screen 11] AR 포스터 전시 (FS-006).
 *
 * 전시하기 시 본인 포스터를 전시대(20슬롯)에 부착하고, 사용자 주변에 원형으로
 * 배치된 포스터들을 AR로 둘러봅니다.
 *
 * 렌더 백엔드:
 *  1) 8th Wall(오픈소스) 월드 트래킹 — 가능하면 우선 사용(실기기 6DoF).
 *  2) 폴백 — 카메라 피드 + 자이로/자동회전 Three.js 뷰(데스크톱/미지원 기기).
 */
export class PosterExhibitPage implements Page {
  private manager = new PosterExhibitManager();
  private eighthWall = new EighthWallController();
  private tracker = new ImageTargetTracker();

  // 폴백 렌더 컨텍스트.
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private rafId = 0;
  // 시선(yaw/pitch): target = 입력값, cur = 화면에 적용되는 보간값(떨림 제거).
  private targetYaw = 0;
  private curYaw = 0;
  private targetPitch = 0;
  private curPitch = 0;
  private lastAlpha: number | null = null;
  private orientHandler: ((e: DeviceOrientationEvent) => void) | null = null;
  private resizeBound = () => this.onResize();
  private disposed = false;
  // 빌드한 포스터 그룹(GPU 리소스) — unmount 시 dispose 하기 위해 보관.
  private group: THREE.Group | null = null;
  // 드래그 시선 제어 상태(window 리스너에서 공유 → 필드로 보관해 정확히 해제).
  private dragging = false;
  private dragLastX = 0;
  private onPointerUp = (): void => {
    this.dragging = false;
  };
  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragging) return;
    this.targetYaw -= (e.clientX - this.dragLastX) * 0.005;
    this.dragLastX = e.clientX;
  };

  async mount(root: HTMLElement): Promise<void> {
    // 전시하기로 진입: 생성된 포스터를 슬롯에 부착.
    const posterUrl = appState.get().generatedPosterUrl;
    if (posterUrl) {
      const slotId = this.manager.placeMyPoster(posterUrl);
      // 진입 시 본인 포스터를 바라보도록 초기 시선 설정.
      this.targetYaw = this.curYaw = -((slotId / 20) * Math.PI * 2);
      appState.set({ myPosterSlotId: slotId, exhibitSlots: [...this.manager.allSlots] });
    }

    const screen = document.createElement('div');
    screen.className = 'screen ar-exhibit-page';

    const view = document.createElement('div');
    view.className = 'ar-view';
    screen.appendChild(view);

    screen.appendChild(
      createTopBar({
        title: '나만의 영화포스터를 만들어 보세요',
        onBack: () => router.navigate(ROUTES.posterResult),
      }),
    );

    const hint = document.createElement('p');
    hint.className = 'ar-hint';
    hint.textContent = 'AR 엔진 로딩 중...';
    screen.appendChild(hint);
    const lookHint = '주변을 둘러보면 전시된 포스터가 보입니다';

    root.appendChild(screen);

    const canvas = document.createElement('canvas');
    canvas.className = 'ar-canvas';
    view.appendChild(canvas);

    // 1) 8th Wall 우선 시도.
    const ok = await this.eighthWall.start({
      canvas,
      onSceneReady: ({ scene }) => {
        const group = this.manager.buildGroup();
        // await 도중 unmount가 먼저 일어났다면 GPU 리소스를 즉시 해제.
        if (this.disposed) {
          this.manager.disposeGroup(group);
          return;
        }
        this.group = group;
        scene.add(group);
      },
      onError: () => undefined,
    });

    if (this.disposed) {
      this.eighthWall.stop();
      return;
    }
    if (ok) {
      hint.textContent = `${lookHint} (8th Wall AR)`;
      return;
    }

    // 2) 폴백: 카메라 피드 + 자이로/자동회전.
    canvas.remove();
    hint.textContent = lookHint;
    await this.startFallback(view);
  }

  // ---------- 폴백 렌더러 ----------

  private async startFallback(view: HTMLElement): Promise<void> {
    const { video, hasStream } = await this.tracker.startCamera();
    if (this.disposed) return;
    if (hasStream) {
      video.className = 'ar-video';
      view.appendChild(video);
    } else {
      view.classList.add('ar-view--placeholder');
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      70,
      view.clientWidth / view.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 0, 0);
    this.group = this.manager.buildGroup();
    scene.add(this.group);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(view.clientWidth, view.clientHeight);
    const dom = renderer.domElement;
    dom.className = 'ar-canvas';
    view.appendChild(dom);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.setupLook(view);
    window.addEventListener('resize', this.resizeBound);
    this.renderLoop();
  }

  /**
   * 시선 제어: 자이로(DeviceOrientation) + 드래그.
   * 자동회전은 하지 않습니다(포스터가 제자리에 고정되어 보이도록).
   * alpha는 0/360 경계에서 튀므로 '최단 각도 변화'만 누적해 점프를 방지하고,
   * renderLoop에서 부드럽게 보간(lerp)해 떨림을 제거합니다.
   */
  private setupLook(view: HTMLElement): void {
    this.orientHandler = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      const alpha = THREE.MathUtils.degToRad(e.alpha);
      if (this.lastAlpha !== null) {
        let d = alpha - this.lastAlpha;
        while (d > Math.PI) d -= 2 * Math.PI; // 0/360 wrap 처리
        while (d < -Math.PI) d += 2 * Math.PI;
        this.targetYaw -= d;
      }
      this.lastAlpha = alpha;
      // 위아래는 살짝만(과한 흔들림 방지).
      const beta = e.beta ?? 90;
      this.targetPitch = THREE.MathUtils.clamp(
        THREE.MathUtils.degToRad(beta - 90) * 0.35,
        -0.6,
        0.6,
      );
    };
    window.addEventListener('deviceorientation', this.orientHandler);

    // 드래그로 둘러보기(데스크톱/자이로 미허가 기기).
    // pointerup/move는 window에 붙으므로 unmount에서 정확히 해제해야 누수가 없다.
    view.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.dragLastX = e.clientX;
    });
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointermove', this.onPointerMove);
  }

  private renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop);
    if (!this.renderer || !this.scene || !this.camera) return;
    // target → cur 보간(15%)으로 떨림 제거. 입력 없으면 그대로 멈춰 있음(고정).
    this.curYaw += (this.targetYaw - this.curYaw) * 0.15;
    this.curPitch += (this.targetPitch - this.curPitch) * 0.15;
    this.camera.rotation.set(this.curPitch, this.curYaw, 0, 'YXZ');
    this.renderer.render(this.scene, this.camera);
  };

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
  }

  unmount(): void {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resizeBound);
    if (this.orientHandler) {
      window.removeEventListener('deviceorientation', this.orientHandler);
    }
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointermove', this.onPointerMove);
    this.eighthWall.stop();
    this.tracker.stop();
    if (this.group) {
      this.manager.disposeGroup(this.group);
      this.group = null;
    }
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
