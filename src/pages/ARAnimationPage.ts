import * as THREE from 'three';
import type { Page } from './Page';
import { cameraManager, getDefaultArCameraFacing } from '../ar/CameraManager';
import {
  EighthWallController,
  type XrHitTestResult,
  type XrSceneRefs,
} from '../ar/EighthWallController';
import { SkyAnchorModelPlayer } from '../ar/SkyAnchorModelPlayer';
import type { SkyAnchorModelProgress } from '../ar/SkyAnchorModelPlayer';
import { router, ROUTES } from '../utils/router';
import { CHAMELEON_AUDIO, POST_VIDEO_PROPS_HOLD_MS } from '../config/arConfig';
import { cachedUrl } from '../utils/assetPreloader';

const DEBUG_STATE_INTERVAL_MS = 250;
const MAX_AR_PIXEL_RATIO = 1.5;

/**
 * [Module A — Screen 6] 3D 프랍 애니메이션 재생 (FS-003).
 *
 * 카메라 피드 위에 sky-anchor 프랍/카멜레온 스프라이트를 바로 표시합니다.
 * 기존 mp4 본편 재생 단계는 제거했습니다.
 */
export class ARAnimationPage implements Page {
  private eighthWall = new EighthWallController();
  private propsPlayer: SkyAnchorModelPlayer | null = null;
  private propsRenderer: THREE.WebGLRenderer | null = null;
  private ownsPropsRenderer = false;
  private propsScene: THREE.Scene | null = null;
  private propsCamera: THREE.Camera | null = null;
  private xrCanvas: HTMLCanvasElement | null = null;
  private stage: HTMLElement | null = null;
  private arView: HTMLElement | null = null;
  private cameraBackdropVideo: HTMLVideoElement | null = null;
  private cameraBackdropStarted = false;
  private propsLastTime = 0;
  private propsDebugLastTimeMs = 0;
  private propsRafId = 0;
  private propsStarted = false;
  private propsRevealed = false;
  private propsLoaded = false;
  private propsProgress: SkyAnchorModelProgress = { loaded: 0, failed: 0, total: 0 };
  private xrStarting = false;
  private pendingScanReveal = false;
  private lastXrStartError: unknown = null;
  private lastScanHit: XrHitTestResult | null = null;
  private placementReticle: THREE.Group | null = null;
  private scanPoint = { x: 0.5, y: 0.5 };
  private scanButton: HTMLButtonElement | null = null;
  private root!: HTMLElement;
  private disposed = false;
  private endTimer: number | null = null;
  private chameleonAudio: HTMLAudioElement | null = null;
  private readonly handleResize = () => this.syncXrCanvasSize();
  private readonly handleScanClick = () => void this.handleScanRequest();
  private readonly handleViewPointerDown = (event: PointerEvent) => this.setScanPointFromPointer(event);

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    const screen = document.createElement('div');
    screen.className = 'screen ar-animation-page';
    screen.dataset.phase = 'props-loading';

    // 카메라 뷰 레이어 (8th Wall이면 XR8가 이 위에 렌더; dev면 getUserMedia 피드).
    const view = document.createElement('div');
    view.className = 'ar-view';
    view.addEventListener('pointerdown', this.handleViewPointerDown);
    screen.appendChild(view);
    this.arView = view;

    // Three.js 프랍 레이어가 올라갈 오버레이 컨테이너.
    const stage = document.createElement('div');
    stage.className = 'ar-stage';
    screen.appendChild(stage);
    this.stage = stage;

    this.createScanButton(screen);
    root.appendChild(screen);

    if (this.shouldUseEighthWall()) {
      this.setArMode('camera-preview');
      this.setPhase('props-loading');
      this.setScanButtonState('loading');
      const hasCameraPreview = await this.startCameraBackdrop(view, true);
      if (!hasCameraPreview || this.disposed) {
        if (!this.disposed) this.showArRequiredError(this.getArRequiredErrorMessage());
        return;
      }
      const started = await this.startCameraPreviewPropsSequence(view);
      if (!started && !this.disposed) {
        this.showArRequiredError('AR 오브젝트를 불러오지 못했습니다. 새로고침 후 다시 시도해주세요.');
      }
      return;
    }

    const started = await this.startXrPropsSequence(view);
    if (!started && !this.disposed) {
      this.showArRequiredError(this.getArRequiredErrorMessage());
    }
  }

  private async startXrPropsSequence(view: HTMLElement): Promise<boolean> {
    if (this.disposed || this.propsStarted) return false;
    this.propsStarted = true;

    if (!this.shouldUseEighthWall()) {
      return this.startFallbackPropsSequence(view);
    }

    this.setPhase('ar-loading');
    this.setArMode('8thwall');

    const canvas = document.createElement('canvas');
    canvas.className = 'ar-canvas';
    view.appendChild(canvas);
    this.xrCanvas = canvas;
    this.syncXrCanvasSize();
    window.addEventListener('resize', this.handleResize);

    let resolveRefs: (refs: XrSceneRefs) => void = () => undefined;
    const refsPromise = new Promise<XrSceneRefs>((resolve) => {
      resolveRefs = resolve;
    });

    const ok = await this.eighthWall.start({
      canvas,
      worldScale: 'absolute',
      onSceneReady: (refs) => resolveRefs(refs),
      onRender: () => this.renderPropsFrame(performance.now()),
      onStatus: (args) => this.updateXrStatus(args.status, args.error),
      onError: (err) => {
        this.lastXrStartError = err;
        this.updateXrStatus('start-error', err);
      },
    });

    if (!ok || this.disposed) {
      this.cleanupFailedXrStart(canvas);
      return false;
    }

    const refs = await this.waitForXrScene(refsPromise);
    if (!refs || this.disposed) {
      this.lastXrStartError ??= new Error('8th Wall scene timed out');
      this.cleanupFailedXrStart(canvas);
      return false;
    }

    this.initXrPropsScene(refs);

    try {
      await this.loadPropsForScan();
      return true;
    } catch (err) {
      console.error('[ARAnimationPage] xr props failed', err);
      if (!this.propsRevealed) this.navigateToMessage();
      return true;
    }
  }

  private async startFallbackPropsSequence(view: HTMLElement): Promise<boolean> {
    this.setPhase('props-loading');
    this.setArMode('fallback');
    window.addEventListener('resize', this.handleResize);
    await this.startFallbackCameraBackdrop(view);

    if (!this.initFallbackPropsScene(view)) return false;

    try {
      await this.loadPropsForScan();
      this.propsLastTime = 0;
      this.renderFallbackPropsLoop(performance.now());
      return true;
    } catch (err) {
      console.error('[ARAnimationPage] fallback props failed', err);
      return false;
    }
  }

  private async startCameraPreviewPropsSequence(view: HTMLElement): Promise<boolean> {
    if (this.disposed || this.propsStarted) return false;
    this.propsStarted = true;
    this.setPhase('props-loading');
    this.setArMode('camera-preview');
    window.addEventListener('resize', this.handleResize);

    if (!this.initFallbackPropsScene(view)) {
      this.propsStarted = false;
      return false;
    }

    try {
      await this.loadPropsForScan();
      this.propsLastTime = 0;
      this.renderFallbackPropsLoop(performance.now());
      return true;
    } catch (err) {
      console.error('[ARAnimationPage] camera preview props failed', err);
      this.propsStarted = false;
      return false;
    }
  }

  private cleanupFailedXrStart(canvas: HTMLCanvasElement): void {
    this.eighthWall.stop();
    window.removeEventListener('resize', this.handleResize);
    canvas.remove();
    if (this.xrCanvas === canvas) this.xrCanvas = null;
    this.propsStarted = false;
    this.pendingScanReveal = false;
    this.setScanButtonState('ready');
  }

  private shouldUseEighthWall(): boolean {
    const userAgent = navigator.userAgent;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
    return mobileUserAgent && navigator.maxTouchPoints > 0;
  }

  private async loadPropsForScan(): Promise<void> {
    try {
      this.propsPlayer ??= new SkyAnchorModelPlayer();
      await this.propsPlayer?.load((progress) => {
        this.updatePropsLoadProgress(progress);
      });
      if (this.disposed) return;
      this.propsLoaded = true;
      this.setPhase('scan-ready');
      if (this.isWorldTrackingMode()) {
        this.updateScanHitReadiness();
      } else {
        this.setScanButtonState('ready');
      }
      this.updatePropsDebugState();
    } catch (err) {
      throw err;
    }
  }

  private async waitForXrScene(refsPromise: Promise<XrSceneRefs>): Promise<XrSceneRefs | null> {
    return Promise.race([
      refsPromise,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 5000);
      }),
    ]);
  }

  private revealPropsOnce(): void {
    if (this.disposed || this.propsRevealed) return;

    this.propsRevealed = true;
    this.setScanButtonState('locked');
    this.propsPlayer?.reveal(true);
    this.setPhase('props');
    this.updatePropsDebugState();
    this.endTimer = window.setTimeout(
      () => this.navigateToMessage(),
      POST_VIDEO_PROPS_HOLD_MS,
    );
    this.playChameleonAudio();
  }

  private initXrPropsScene({ scene, camera, renderer }: XrSceneRefs): void {
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);

    this.addPropsLights(scene);

    this.propsPlayer ??= new SkyAnchorModelPlayer();
    this.propsPlayer.attachToScene(scene);
    this.placementReticle = this.createPlacementReticle();
    scene.add(this.placementReticle);
    this.propsRenderer = renderer;
    this.ownsPropsRenderer = false;
    this.propsScene = scene;
    this.propsCamera = camera;
    this.syncXrCanvasSize();
  }

  private initFallbackPropsScene(view: HTMLElement): boolean {
    const renderer = this.createModelOverlayRenderer();
    if (!renderer) return false;

    const rect = view.getBoundingClientRect();
    const width = Math.max(1, rect.width || window.innerWidth);
    const height = Math.max(1, rect.height || window.innerHeight);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.01, 100);
    camera.position.set(0, 0, 0);

    this.addPropsLights(scene);
    this.propsPlayer ??= new SkyAnchorModelPlayer();
    this.propsPlayer.attachToScene(scene);
    this.propsRenderer = renderer;
    this.ownsPropsRenderer = true;
    this.propsScene = scene;
    this.propsCamera = camera;
    this.syncXrCanvasSize();
    return true;
  }

  private createModelOverlayRenderer(): THREE.WebGLRenderer | null {
    if (!this.stage) return null;

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    renderer.autoClear = true;
    renderer.domElement.className = 'ar-model-canvas';
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.stage.replaceChildren(renderer.domElement);
    return renderer;
  }

  private playChameleonAudio(): void {
    this.chameleonAudio?.pause();
    const audio = new Audio(cachedUrl(CHAMELEON_AUDIO));
    audio.preload = 'auto';
    this.chameleonAudio = audio;
    void audio.play().catch(() => undefined);
  }

  private addPropsLights(scene: THREE.Scene): void {
    scene.add(new THREE.AmbientLight('#ffffff', 1.45));
    const key = new THREE.DirectionalLight('#ffffff', 2.1);
    key.position.set(-3, 6, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight('#ffffff', 1.2);
    fill.position.set(3, 2, 5);
    scene.add(fill);
  }

  private renderPropsFrame(timeMs: number): void {
    if (!this.propsCamera) return;

    this.syncXrCanvasSize();
    const time = timeMs / 1000;
    const delta = this.propsLastTime > 0
      ? Math.min(Math.max(time - this.propsLastTime, 1 / 120), 1 / 15)
      : 1 / 60;
    this.propsLastTime = time;
    this.propsPlayer?.update(delta, time);
    this.updateScanHitReadiness();
    const shouldUpdateDebug = timeMs - this.propsDebugLastTimeMs >= DEBUG_STATE_INTERVAL_MS;
    if (shouldUpdateDebug) {
      this.propsDebugLastTimeMs = timeMs;
      this.updatePropsDebugState();
    }
    if (this.propsRenderer && this.propsScene) {
      if (this.ownsPropsRenderer) {
        this.propsRenderer.clear(true, true, true);
        this.propsRenderer.render(this.propsScene, this.propsCamera);
      }
      if (shouldUpdateDebug) this.updatePropsRenderDebugState();
    }
  }

  private updatePropsRenderDebugState(): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (!screen || !this.propsRenderer) return;

    screen.dataset.propRenderCalls = String(this.propsRenderer.info.render.calls);
    screen.dataset.propRenderTriangles = String(this.propsRenderer.info.render.triangles);
  }

  private renderFallbackPropsLoop = (timeMs: number): void => {
    this.propsRafId = requestAnimationFrame(this.renderFallbackPropsLoop);
    this.renderPropsFrame(timeMs);
  };

  private updatePropsDebugState(): void {
    const state = this.propsPlayer?.getDebugState();
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (!state || !screen) return;

    screen.dataset.propBatch = state.activeBatch >= 0 ? String(state.activeBatch + 1) : '';
    screen.dataset.propBatchTotal = String(state.totalBatches);
    screen.dataset.propVisible = String(state.visibleCount);
    screen.dataset.propPersistentVisible = String(state.persistentVisibleCount);
    screen.dataset.propOriginLockedVisible = String(state.originLockedVisibleCount);
    screen.dataset.propLoaded = String(state.loadedCount);
    screen.dataset.propAnchorLocked = state.anchorLocked ? 'true' : 'false';
    screen.dataset.propAnchorX = state.anchorX.toFixed(3);
    screen.dataset.propAnchorY = state.anchorY.toFixed(3);
    screen.dataset.propAnchorZ = state.anchorZ.toFixed(3);
    screen.dataset.propAnchorMode = state.anchorMode;
    screen.dataset.propPngSequenceCount = String(state.pngSequenceCount);
    screen.dataset.propPngSequenceVisible = String(state.pngSequenceVisibleCount);
    screen.dataset.propPngSequenceFrame = String(state.pngSequenceFrame);
    screen.dataset.propPngSequenceFrameCount = String(state.pngSequenceFrameCount);
    screen.dataset.propPngSequenceLabel = state.pngSequenceLabel;

    const bounds = this.propsPlayer?.getVisibleWorldBounds();
    const canvas = this.getPropsCanvas();
    if (!bounds || bounds.isEmpty() || !this.propsCamera || !canvas) return;

    const screenBounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    };

    [
      [bounds.min.x, bounds.min.y, bounds.min.z],
      [bounds.min.x, bounds.min.y, bounds.max.z],
      [bounds.min.x, bounds.max.y, bounds.min.z],
      [bounds.min.x, bounds.max.y, bounds.max.z],
      [bounds.max.x, bounds.min.y, bounds.min.z],
      [bounds.max.x, bounds.min.y, bounds.max.z],
      [bounds.max.x, bounds.max.y, bounds.min.z],
      [bounds.max.x, bounds.max.y, bounds.max.z],
    ].forEach(([x, y, z]) => {
      const projected = new THREE.Vector3(x, y, z).project(this.propsCamera!);
      const screenX = (projected.x * 0.5 + 0.5) * canvas.clientWidth;
      const screenY = (-projected.y * 0.5 + 0.5) * canvas.clientHeight;

      screenBounds.minX = Math.min(screenBounds.minX, screenX);
      screenBounds.minY = Math.min(screenBounds.minY, screenY);
      screenBounds.maxX = Math.max(screenBounds.maxX, screenX);
      screenBounds.maxY = Math.max(screenBounds.maxY, screenY);
    });

    if (!Number.isFinite(screenBounds.minX)) return;

    screen.dataset.propScreenCenterX = String(Math.round((screenBounds.minX + screenBounds.maxX) / 2));
    screen.dataset.propScreenCenterY = String(Math.round((screenBounds.minY + screenBounds.maxY) / 2));
    screen.dataset.propScreenWidth = String(Math.round(screenBounds.maxX - screenBounds.minX));
    screen.dataset.propScreenHeight = String(Math.round(screenBounds.maxY - screenBounds.minY));
    screen.dataset.propVisibleItems = JSON.stringify(this.getVisibleItemScreenBounds());
  }

  private getVisibleItemScreenBounds(): Array<{
    centerX: number;
    centerY: number;
    height: number;
    label: string;
    maxZ: number;
    minZ: number;
    offscreen: boolean;
    opacity: number;
    sequenceIndex: number;
    width: number;
  }> {
    const canvas = this.getPropsCanvas();
    if (!this.propsCamera || !canvas || !this.propsPlayer) return [];

    return this.propsPlayer.getVisibleItemBounds().map((item) => {
      const screenBounds = {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
        maxZ: Number.NEGATIVE_INFINITY,
        minZ: Number.POSITIVE_INFINITY,
      };

      [
        [item.bounds.min.x, item.bounds.min.y, item.bounds.min.z],
        [item.bounds.min.x, item.bounds.min.y, item.bounds.max.z],
        [item.bounds.min.x, item.bounds.max.y, item.bounds.min.z],
        [item.bounds.min.x, item.bounds.max.y, item.bounds.max.z],
        [item.bounds.max.x, item.bounds.min.y, item.bounds.min.z],
        [item.bounds.max.x, item.bounds.min.y, item.bounds.max.z],
        [item.bounds.max.x, item.bounds.max.y, item.bounds.min.z],
        [item.bounds.max.x, item.bounds.max.y, item.bounds.max.z],
      ].forEach(([x, y, z]) => {
        const projected = new THREE.Vector3(x, y, z).project(this.propsCamera!);
        const screenX = (projected.x * 0.5 + 0.5) * canvas.clientWidth;
        const screenY = (-projected.y * 0.5 + 0.5) * canvas.clientHeight;

        screenBounds.minX = Math.min(screenBounds.minX, screenX);
        screenBounds.minY = Math.min(screenBounds.minY, screenY);
        screenBounds.maxX = Math.max(screenBounds.maxX, screenX);
        screenBounds.maxY = Math.max(screenBounds.maxY, screenY);
        screenBounds.minZ = Math.min(screenBounds.minZ, projected.z);
        screenBounds.maxZ = Math.max(screenBounds.maxZ, projected.z);
      });

      const width = Math.round(screenBounds.maxX - screenBounds.minX);
      const height = Math.round(screenBounds.maxY - screenBounds.minY);
      return {
        centerX: Math.round((screenBounds.minX + screenBounds.maxX) / 2),
        centerY: Math.round((screenBounds.minY + screenBounds.maxY) / 2),
        height,
        label: item.label,
        maxZ: Number(screenBounds.maxZ.toFixed(3)),
        minZ: Number(screenBounds.minZ.toFixed(3)),
        offscreen:
          screenBounds.maxX < 0 ||
          screenBounds.maxY < 0 ||
          screenBounds.minX > canvas.clientWidth ||
          screenBounds.minY > canvas.clientHeight ||
          screenBounds.minZ > 1 ||
          screenBounds.maxZ < -1,
        opacity: Number(item.opacity.toFixed(3)),
        sequenceIndex: item.sequenceIndex,
        width,
      };
    });
  }

  private getPropsCanvas(): HTMLCanvasElement | null {
    return this.propsRenderer?.domElement ?? this.xrCanvas;
  }

  private syncXrCanvasSize(): void {
    const canvas = this.getPropsCanvas();
    if (!canvas) return;

    const host = canvas.parentElement ?? this.root.querySelector<HTMLElement>('.ar-view') ?? this.root;
    const rect = host.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssHeight = Math.max(1, Math.round(rect.height || window.innerHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_AR_PIXEL_RATIO);

    canvas.style.setProperty('position', 'absolute', 'important');
    canvas.style.setProperty('inset', '0', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
    canvas.style.setProperty('display', 'block', 'important');

    if (this.propsRenderer && this.ownsPropsRenderer) {
      this.propsRenderer.setPixelRatio(pixelRatio);
      this.propsRenderer.setSize(cssWidth, cssHeight, false);
    } else {
      const pixelWidth = Math.round(cssWidth * pixelRatio);
      const pixelHeight = Math.round(cssHeight * pixelRatio);
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    }

    if (this.propsCamera instanceof THREE.PerspectiveCamera) {
      const aspect = cssWidth / cssHeight;
      if (Math.abs(this.propsCamera.aspect - aspect) > 0.001) {
        this.propsCamera.aspect = aspect;
        this.propsCamera.updateProjectionMatrix();
      }
    }
  }

  private updatePropsLoadProgress(progress: SkyAnchorModelProgress): void {
    this.propsProgress = progress;
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (!screen) return;

    screen.dataset.propLoaded = String(progress.loaded);
    screen.dataset.propFailed = String(progress.failed);
    screen.dataset.propTotal = String(progress.total);
    screen.dataset.propDownloaded = String(progress.loaded + progress.failed);
    this.updateScanButtonLabel();
  }

  private createScanButton(screen: HTMLElement): void {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ar-scan-button';
    button.textContent = '스캔';
    button.disabled = true;
    button.addEventListener('click', this.handleScanClick);
    screen.dataset.scanState = 'loading';
    screen.appendChild(button);
    this.scanButton = button;
  }

  private setScanButtonState(state: 'loading' | 'ready' | 'locked'): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) screen.dataset.scanState = state;
    if (!this.scanButton) return;

    this.scanButton.disabled = state !== 'ready';
    this.updateScanButtonLabel();
  }

  private updateScanButtonLabel(): void {
    if (!this.scanButton) return;
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    const state = screen?.dataset.scanState ?? 'loading';
    if (state === 'loading' && !this.propsLoaded) {
      const total = this.propsProgress.total;
      const done = this.propsProgress.loaded + this.propsProgress.failed;
      this.scanButton.textContent = total > 0 ? `${done}/${total}` : '로딩';
      return;
    }
    this.scanButton.textContent = '스캔';
  }

  private async handleScanRequest(): Promise<void> {
    if (this.disposed || this.propsRevealed || this.xrStarting) return;

    this.removeArRequiredError();
    if (!this.propsStarted) {
      const view = this.arView;
      if (!view) return;

      this.xrStarting = true;
      this.pendingScanReveal = true;
      this.lastXrStartError = null;
      this.setPhase('ar-loading');
      this.setScanButtonState('loading');
      const started = await this.startXrPropsSequence(view);
      this.xrStarting = false;

      if (!started && !this.disposed) {
        this.pendingScanReveal = false;
        this.showArRequiredError(this.getArRequiredErrorMessage());
      } else if (!this.disposed && !this.isWorldTrackingMode()) {
        this.scanAndRevealProps();
      }
      return;
    }

    this.pendingScanReveal = true;
    this.scanAndRevealProps();
  }

  private scanAndRevealProps(): void {
    if (
      this.disposed ||
      this.propsRevealed ||
      !this.propsLoaded ||
      !this.propsPlayer ||
      !this.propsCamera
    ) {
      return;
    }

    this.setScanButtonState('locked');
    this.setPhase('anchor-locked');
    if (this.isWorldTrackingMode()) {
      const hit = this.lastScanHit ?? this.getBestScanHit();
      if (!hit) {
        this.pendingScanReveal = true;
        this.setScanButtonState('loading');
        this.setPhase('scan-ready');
        return;
      }
      this.pendingScanReveal = false;
      this.propsPlayer.lockToHitTestResult(hit, this.propsCamera);
      this.setPlacementReticleVisible(false);
    } else {
      this.pendingScanReveal = false;
      this.propsPlayer.lockToFallbackWorld();
    }
    this.updatePropsDebugState();
    this.revealPropsOnce();
  }

  private setScanPointFromPointer(event: PointerEvent): void {
    if (!this.arView || this.propsRevealed) return;

    const rect = this.arView.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    this.scanPoint = {
      x: THREE.MathUtils.clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: THREE.MathUtils.clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) {
      screen.dataset.scanX = this.scanPoint.x.toFixed(3);
      screen.dataset.scanY = this.scanPoint.y.toFixed(3);
    }
    this.updateScanHitReadiness();
  }

  private updateScanHitReadiness(): void {
    if (!this.propsLoaded || this.propsRevealed || !this.isWorldTrackingMode()) return;

    this.lastScanHit = this.getBestScanHit();
    this.updatePlacementReticle(this.lastScanHit);
    if (this.pendingScanReveal && this.lastScanHit) {
      this.scanAndRevealProps();
      return;
    }
    this.setScanButtonState(this.lastScanHit ? 'ready' : 'loading');
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) {
      screen.dataset.scanHitReady = this.lastScanHit ? 'true' : 'false';
      screen.dataset.scanHitType = this.lastScanHit?.type ?? '';
      screen.dataset.scanHitDistance = this.lastScanHit?.distance?.toFixed(3) ?? '';
    }
  }

  private createPlacementReticle(): THREE.Group {
    const reticle = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.92,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.105, 0.132, 48), material);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.018, 24), material.clone());
    ring.rotation.x = -Math.PI / 2;
    dot.rotation.x = -Math.PI / 2;
    ring.renderOrder = 1200;
    dot.renderOrder = 1201;
    reticle.name = 'bifan-world-placement-reticle';
    reticle.add(ring, dot);
    reticle.visible = false;
    return reticle;
  }

  private updatePlacementReticle(hit: XrHitTestResult | null): void {
    if (!this.placementReticle || !this.isWorldTrackingMode()) return;

    if (!hit) {
      this.setPlacementReticleVisible(false);
      return;
    }

    this.placementReticle.position.set(hit.position.x, hit.position.y + 0.015, hit.position.z);
    this.placementReticle.rotation.set(0, 0, 0);
    this.setPlacementReticleVisible(true);
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) {
      screen.dataset.reticleX = hit.position.x.toFixed(3);
      screen.dataset.reticleY = hit.position.y.toFixed(3);
      screen.dataset.reticleZ = hit.position.z.toFixed(3);
    }
  }

  private setPlacementReticleVisible(visible: boolean): void {
    if (this.placementReticle) this.placementReticle.visible = visible;
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) screen.dataset.reticleVisible = visible ? 'true' : 'false';
  }

  private isWorldTrackingMode(): boolean {
    return !!this.xrCanvas && !this.ownsPropsRenderer;
  }

  private getBestScanHit(): XrHitTestResult | null {
    const hits = this.eighthWall.hitTest(this.scanPoint.x, this.scanPoint.y, [
      'DETECTED_SURFACE',
      'ESTIMATED_SURFACE',
      'FEATURE_POINT',
    ]);
    if (!hits.length) return null;

    return [...hits].sort((a, b) => {
      const typeDiff = this.getHitTypeRank(a.type) - this.getHitTypeRank(b.type);
      if (typeDiff !== 0) return typeDiff;
      return (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY);
    })[0] ?? null;
  }

  private getHitTypeRank(type: string): number {
    if (type === 'DETECTED_SURFACE') return 0;
    if (type === 'ESTIMATED_SURFACE') return 1;
    if (type === 'FEATURE_POINT') return 2;
    return 3;
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

  private setArMode(mode: '8thwall' | 'fallback' | 'camera-preview'): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) screen.dataset.arMode = mode;
  }

  private updateXrStatus(status: string, error?: unknown): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (!screen) return;
    screen.dataset.xrStatus = status;
    screen.dataset.xrError = error instanceof Error ? error.message : String(error ?? '');
  }

  private async startFallbackCameraBackdrop(view: HTMLElement): Promise<void> {
    await this.startCameraBackdrop(view, false);
  }

  private async startCameraBackdrop(
    view: HTMLElement,
    allowPrompt: boolean,
  ): Promise<boolean> {
    if (this.cameraBackdropStarted || this.disposed) return this.cameraBackdropStarted;
    this.cameraBackdropStarted = true;

    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    const stream = await cameraManager.acquire(getDefaultArCameraFacing(), { allowPrompt });
    if (this.disposed) return false;

    if (!stream) {
      this.cameraBackdropStarted = false;
      this.lastXrStartError = new Error('camera permission denied');
      view.classList.add('ar-view--placeholder');
      if (screen) screen.dataset.cameraBackdrop = 'denied';
      return false;
    }

    const video = document.createElement('video');
    video.className = 'ar-video ar-camera-backdrop';
    if (!cameraManager.attachTo(video)) {
      this.cameraBackdropStarted = false;
      this.lastXrStartError = new Error('camera stream unavailable');
      view.classList.add('ar-view--placeholder');
      if (screen) screen.dataset.cameraBackdrop = 'unavailable';
      return false;
    }

    this.cameraBackdropVideo?.remove();
    this.cameraBackdropVideo = video;
    view.prepend(video);
    if (screen) {
      screen.dataset.cameraBackdrop = 'active';
    }
    return true;
  }

  private stopCameraBackdrop(releaseCamera: boolean): void {
    this.cameraBackdropVideo?.pause();
    this.cameraBackdropVideo && (this.cameraBackdropVideo.srcObject = null);
    this.cameraBackdropVideo?.removeAttribute('src');
    this.cameraBackdropVideo?.load();
    this.cameraBackdropVideo?.remove();
    this.cameraBackdropVideo = null;
    this.cameraBackdropStarted = false;
    if (releaseCamera) cameraManager.release();
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (screen) screen.dataset.cameraBackdrop = releaseCamera ? 'released' : 'stopped';
  }

  private showArRequiredError(message: string): void {
    this.setPhase('ar-error');
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    if (!screen) return;
    screen.dataset.arMode = '8thwall-required';
    this.setScanButtonState('ready');
    this.removeArRequiredError();

    const panel = document.createElement('div');
    panel.className = 'ar-required';
    const title = document.createElement('strong');
    title.textContent = '8th Wall AR 필요';
    const body = document.createElement('span');
    body.textContent = message;
    panel.append(title, body);
    screen.appendChild(panel);
  }

  private removeArRequiredError(): void {
    const screen = this.root.querySelector<HTMLElement>('.ar-animation-page');
    screen?.querySelectorAll('.ar-required').forEach((el) => el.remove());
  }

  private getArRequiredErrorMessage(): string {
    if (this.isIosNonSafari()) {
      return 'iPhone에서는 Safari로 열고 카메라 권한을 허용한 뒤 다시 스캔해주세요.';
    }

    const message = this.lastXrStartError instanceof Error
      ? this.lastXrStartError.message
      : String(this.lastXrStartError ?? '');
    if (/denied|notallowed|permission/i.test(message)) {
      return '카메라 권한이 거부되었습니다. 브라우저 설정에서 카메라를 허용한 뒤 다시 스캔해주세요.';
    }
    if (/engine|load|chunk|slam/i.test(message)) {
      return 'AR 엔진을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 스캔해주세요.';
    }
    return 'AR을 시작하지 못했습니다. HTTPS 모바일 브라우저에서 카메라 권한을 허용한 뒤 다시 스캔해주세요.';
  }

  private isIosNonSafari(): boolean {
    const ua = navigator.userAgent;
    const isiOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
    return isiOS && !isSafari;
  }

  unmount(): void {
    this.disposed = true;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.chameleonAudio?.pause();
    this.chameleonAudio?.removeAttribute('src');
    this.chameleonAudio?.load();
    this.chameleonAudio = null;
    this.stopCameraBackdrop(false);
    this.scanButton?.removeEventListener('click', this.handleScanClick);
    this.scanButton?.remove();
    this.scanButton = null;
    this.arView?.removeEventListener('pointerdown', this.handleViewPointerDown);
    this.arView = null;
    this.propsLoaded = false;
    this.lastScanHit = null;
    this.placementReticle?.removeFromParent();
    this.placementReticle = null;
    this.propsPlayer?.dispose();
    this.propsPlayer = null;
    this.eighthWall.stop();
    cancelAnimationFrame(this.propsRafId);
    this.propsRafId = 0;
    window.removeEventListener('resize', this.handleResize);
    this.xrCanvas?.remove();
    this.xrCanvas = null;
    if (this.ownsPropsRenderer) {
      this.propsRenderer?.dispose();
      this.propsRenderer?.domElement.remove();
    }
    this.propsRenderer = null;
    this.ownsPropsRenderer = false;
    this.propsScene = null;
    this.propsCamera = null;
    this.stage = null;
  }
}
