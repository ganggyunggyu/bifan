import * as THREE from 'three';
import type { Page } from './Page';
import { createTopBar } from '../components/TopBar';
import {
  EighthWallController,
  type XrHitTestResult,
  type XrSceneRefs,
} from '../ar/EighthWallController';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { PosterExhibitManager } from '../ar/PosterExhibitManager';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/**
 * [Module B — Screen 11] AR 포스터 전시 (FS-006).
 *
 * 전시하기 시 현재 포스터를 localStorage 전시 슬롯에 저장하고,
 * 저장된 포스터들을 정면 일렬 AR 갤러리로 띄웁니다.
 *
 * 모바일에서는 8th Wall 월드 트래킹 씬에 고정하고,
 * 미지원 환경에서는 카메라 피드 + 자이로/드래그 Three.js 뷰로 폴백합니다.
 */
export class PosterExhibitPage implements Page {
  private static readonly WALL_SURFACE_OFFSET = 0.012;
  private static readonly MIN_WALL_LOCK_DISTANCE = 1.2;
  private static readonly TARGET_WALL_LOCK_DISTANCE = 2.8;
  private static readonly HIT_STABLE_SAMPLE_COUNT = 14;
  private static readonly HIT_STABLE_MIN_LOCK_MS = 700;
  private static readonly HIT_STABLE_MAX_DEVIATION = 0.032;
  private static readonly HIT_SAMPLE_RESET_DISTANCE = 0.1;
  private static readonly DEBUG_STATE_INTERVAL_MS = 250;

  private eighthWall = new EighthWallController();
  private manager = new PosterExhibitManager();
  private tracker = new ImageTargetTracker();

  // 폴백 렌더 컨텍스트.
  private renderer: THREE.WebGLRenderer | null = null;
  private ownsRenderer = false;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private xrCamera: THREE.Camera | null = null;
  private xrCanvas: HTMLCanvasElement | null = null;
  private rafId = 0;
  private root: HTMLElement | null = null;
  private hintEl: HTMLElement | null = null;
  private loadingEl: HTMLElement | null = null;
  private repositionBtn: HTMLButtonElement | null = null;
  private anchorLocked = false;
  private anchorFallbackTimer: number | null = null;
  private repositionCount = 0;
  private hitSamples: XrHitTestResult[] = [];
  private hitSampleStartedAt: number | null = null;
  private xrTrackingStatus = 'UNKNOWN';
  private lastWorldDebugMs = 0;
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
    this.root = root;
    const posterUrl = appState.get().generatedPosterUrl;
    if (!posterUrl) {
      router.navigate(ROUTES.poster);
      return;
    }
    const slotId = this.manager.placeMyPoster(posterUrl);
    appState.set({
      myPosterSlotId: slotId,
      exhibitSlots: [...this.manager.allSlots],
    });

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
    hint.textContent = '전시 공간 로딩 중...';
    screen.appendChild(hint);
    this.hintEl = hint;
    const lookHint = '저장된 포스터를 전시 중입니다';

    const reposition = document.createElement('button');
    reposition.type = 'button';
    reposition.className = 'ar-reposition';
    reposition.textContent = '재배치';
    reposition.addEventListener('click', () => this.repositionPoster());
    screen.appendChild(reposition);
    this.repositionBtn = reposition;

    const loading = document.createElement('div');
    loading.className = 'ar-anchor-loading';
    loading.setAttribute('aria-live', 'polite');
    const loadingSpinner = document.createElement('span');
    loadingSpinner.className = 'ar-anchor-loading__spinner';
    const loadingText = document.createElement('span');
    loadingText.className = 'ar-anchor-loading__text';
    loadingText.textContent = '배치 중...';
    loading.append(loadingSpinner, loadingText);
    screen.appendChild(loading);
    this.loadingEl = loading;

    root.appendChild(screen);

    if (this.shouldUseEighthWall()) {
      const started = await this.startWorldTracked(view, hint);
      if (started || this.disposed) return;
    }

    hint.textContent = lookHint;
    await this.startFallback(view);
  }

  // ---------- Module B 전시 렌더러 ----------

  private async startWorldTracked(
    view: HTMLElement,
    hint: HTMLElement,
  ): Promise<boolean> {
    this.setArMode('8thwall');
    this.setAnchorState(false, 'xr-starting');

    const canvas = document.createElement('canvas');
    canvas.className = 'ar-canvas';
    view.appendChild(canvas);
    this.xrCanvas = canvas;

    let resolveRefs: (refs: XrSceneRefs) => void = () => undefined;
    const refsPromise = new Promise<XrSceneRefs>((resolve) => {
      resolveRefs = resolve;
    });

    const ok = await this.eighthWall.start({
      canvas,
      worldScale: 'absolute',
      onSceneReady: (refs) => resolveRefs(refs),
      onUpdate: (args) => {
        this.updateTrackingStatus(args);
        this.tryLockPosterToHit();
      },
      onRender: () => this.updateWorldTrackedDebug(),
      onStatus: (args) => {
        if (args.status === 'failed') this.setAnchorState(false, 'xr-camera-failed');
      },
      onError: () => undefined,
    });

    if (!ok || this.disposed) {
      this.eighthWall.stop();
      canvas.remove();
      this.xrCanvas = null;
      return false;
    }

    const refs = await this.waitForXrScene(refsPromise);
    if (!refs || this.disposed) {
      this.eighthWall.stop();
      canvas.remove();
      this.xrCanvas = null;
      return false;
    }

    this.initWorldTrackedScene(refs);
    hint.textContent = '벽면을 비추면 포스터가 그 위치에 고정됩니다';
    this.setAnchorState(false, 'hittest-waiting');
    return true;
  }

  private waitForXrScene(refsPromise: Promise<XrSceneRefs>): Promise<XrSceneRefs | null> {
    return Promise.race([
      refsPromise,
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 5000);
      }),
    ]);
  }

  private initWorldTrackedScene({ scene, camera, renderer }: XrSceneRefs): void {
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);

    this.group = this.manager.buildPosterLineGroup();
    this.group.visible = false;
    this.group.name = 'bifan-ai-poster-line-world-anchor';
    scene.add(this.group);

    this.xrCamera = camera;
    this.scene = scene;
    this.renderer = renderer;
    this.ownsRenderer = false;
  }

  private async startFallback(view: HTMLElement): Promise<void> {
    this.setArMode('fallback');
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
    this.group = this.manager.buildPosterLineGroup();
    this.group.position.set(0, 0, -this.manager.fallbackDistance);
    this.group.visible = true;
    this.group.name = 'bifan-ai-poster-line-fallback-anchor';
    scene.add(this.group);
    this.freezePosterTransform(this.group);
    this.setAnchorState(true, 'fallback-fixed');

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(view.clientWidth, view.clientHeight);
    const dom = renderer.domElement;
    dom.className = 'ar-canvas';
    view.appendChild(dom);

    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.ownsRenderer = true;

    this.setupLook(view);
    window.addEventListener('resize', this.resizeBound);
    this.renderLoop();
  }

  private tryLockPosterToHit(): void {
    if (this.disposed || this.anchorLocked || !this.group || !this.xrCamera) return;
    if (!this.isTrackingReady()) {
      this.resetHitSamples();
      this.setAnchorState(false, `tracking:${this.xrTrackingStatus}`);
      return;
    }

    const hit = this.getBestHit();
    if (!hit) {
      this.resetHitSamples();
      this.setAnchorState(false, 'hittest-waiting');
      return;
    }

    const stableHit = this.getStableHit(hit);
    if (!stableHit) {
      this.setAnchorState(false, `hittest-stabilizing:${hit.type ?? 'UNKNOWN'}`);
      return;
    }

    this.lockPosterToHit(stableHit);
  }

  private lockPosterToHit(hit: XrHitTestResult): void {
    if (!this.group || !this.xrCamera || this.anchorLocked) return;
    this.group.matrixAutoUpdate = true;
    this.group.position.set(hit.position.x, hit.position.y, hit.position.z);
    const surfaceNormal = this.facePosterToCamera(this.group, this.xrCamera);
    this.group.position.addScaledVector(surfaceNormal, PosterExhibitPage.WALL_SURFACE_OFFSET);
    this.group.visible = true;
    this.freezePosterTransform(this.group);
    this.clearAnchorFallbackTimer();
    this.setPlacementHint('저장된 포스터를 전시 중입니다');
    this.setAnchorState(true, `hittest:${hit.type ?? 'UNKNOWN'}`);
  }

  private lockPosterInFrontOfCamera(mode: string): void {
    if (!this.group || this.anchorLocked) return;
    this.group.matrixAutoUpdate = true;
    const camera = this.xrCamera ?? this.camera;
    if (camera) {
      const cameraPos = new THREE.Vector3();
      const cameraDir = new THREE.Vector3();
      camera.getWorldPosition(cameraPos);
      camera.getWorldDirection(cameraDir);
      this.group.position.copy(cameraPos).addScaledVector(cameraDir, this.manager.fallbackDistance);
      this.group.position.y = cameraPos.y;
      this.facePosterToCamera(this.group, camera);
    } else {
      this.group.position.set(0, 0, -this.manager.fallbackDistance);
    }
    this.group.visible = true;
    this.freezePosterTransform(this.group);
    this.clearAnchorFallbackTimer();
    this.setPlacementHint('저장된 포스터를 전시 중입니다');
    this.setAnchorState(true, mode);
  }

  private repositionPoster(): void {
    this.repositionCount += 1;
    this.anchorLocked = false;
    this.resetHitSamples();
    this.clearAnchorFallbackTimer();

    const mode = this.root?.querySelector<HTMLElement>('.ar-exhibit-page')?.dataset.arMode;
    if (this.group) this.group.matrixAutoUpdate = true;
    if (mode === 'fallback') {
      this.lockPosterInFrontOfCamera('fallback-repositioned');
      return;
    }

    if (this.group) {
      this.group.visible = false;
      this.group.updateMatrixWorld(true);
    }
    if (this.hintEl) {
      this.hintEl.textContent = '화면 중앙을 벽면에 맞추면 다시 배치됩니다';
    }
    this.setAnchorState(false, 'xr-repositioning');
  }

  private facePosterToCamera(group: THREE.Group, camera: THREE.Camera): THREE.Vector3 {
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);
    const dx = cameraPos.x - group.position.x;
    const dz = cameraPos.z - group.position.z;
    group.rotation.set(0, Math.atan2(dx, dz), 0);
    const normal = new THREE.Vector3(dx, 0, dz);
    if (normal.lengthSq() < 0.000001) return new THREE.Vector3(0, 0, 1);
    return normal.normalize();
  }

  private getBestHit(): XrHitTestResult | null {
    const hits = this.eighthWall.hitTest(0.5, 0.5, [
      'DETECTED_SURFACE',
      'ESTIMATED_SURFACE',
    ]);
    const farEnoughHits = hits.filter((hit) => this.isHitFarEnough(hit));
    if (!farEnoughHits.length) return null;
    return [...farEnoughHits].sort((a, b) => {
      const typeDiff = this.getHitTypeRank(a.type) - this.getHitTypeRank(b.type);
      if (typeDiff !== 0) return typeDiff;
      return this.getTargetDistanceDelta(a) - this.getTargetDistanceDelta(b);
    })[0] ?? null;
  }

  private getHitTypeRank(type: string): number {
    if (type === 'DETECTED_SURFACE') return 0;
    if (type === 'ESTIMATED_SURFACE') return 1;
    return 3;
  }

  private getStableHit(hit: XrHitTestResult): XrHitTestResult | null {
    const position = this.toVector(hit);
    const last = this.hitSamples[this.hitSamples.length - 1];
    if (
      last &&
      (last.type !== hit.type ||
        position.distanceTo(this.toVector(last)) > PosterExhibitPage.HIT_SAMPLE_RESET_DISTANCE)
    ) {
      this.resetHitSamples();
    }

    if (this.hitSamples.length === 0) {
      this.hitSampleStartedAt = performance.now();
    }
    this.hitSamples.push(hit);
    if (this.hitSamples.length > PosterExhibitPage.HIT_STABLE_SAMPLE_COUNT) {
      this.hitSamples.shift();
    }
    if (this.hitSamples.length < PosterExhibitPage.HIT_STABLE_SAMPLE_COUNT) return null;

    const avg = new THREE.Vector3();
    this.hitSamples.forEach((sample) => avg.add(this.toVector(sample)));
    avg.multiplyScalar(1 / this.hitSamples.length);

    const maxDeviation = Math.max(
      ...this.hitSamples.map((sample) => avg.distanceTo(this.toVector(sample))),
    );
    if (maxDeviation > PosterExhibitPage.HIT_STABLE_MAX_DEVIATION) {
      this.hitSamples = this.hitSamples.slice(-3);
      this.hitSampleStartedAt = performance.now();
      return null;
    }

    if (
      this.hitSampleStartedAt === null ||
      performance.now() - this.hitSampleStartedAt < PosterExhibitPage.HIT_STABLE_MIN_LOCK_MS
    ) {
      return null;
    }

    return {
      ...hit,
      position: { x: avg.x, y: avg.y, z: avg.z },
      distance: this.distanceFromCamera(avg) ?? hit.distance,
    };
  }

  private resetHitSamples(): void {
    this.hitSamples = [];
    this.hitSampleStartedAt = null;
  }

  private toVector(hit: XrHitTestResult): THREE.Vector3 {
    return new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
  }

  private distanceFromCamera(position: THREE.Vector3): number | null {
    const camera = this.xrCamera ?? this.camera;
    if (!camera) return null;
    const cameraPos = new THREE.Vector3();
    camera.getWorldPosition(cameraPos);
    return cameraPos.distanceTo(position);
  }

  private isTrackingReady(): boolean {
    return this.xrTrackingStatus === 'UNKNOWN' || this.xrTrackingStatus === 'NORMAL';
  }

  private updateTrackingStatus(args: {
    processCpuResult?: { reality?: { trackingStatus?: string } };
  }): void {
    this.xrTrackingStatus =
      args.processCpuResult?.reality?.trackingStatus ?? this.xrTrackingStatus;
  }

  private isHitFarEnough(hit: XrHitTestResult): boolean {
    const distance = this.getHitDistance(hit);
    return distance !== null && distance >= PosterExhibitPage.MIN_WALL_LOCK_DISTANCE;
  }

  private getTargetDistanceDelta(hit: XrHitTestResult): number {
    const distance = this.getHitDistance(hit);
    if (distance === null) return Number.POSITIVE_INFINITY;
    return Math.abs(distance - PosterExhibitPage.TARGET_WALL_LOCK_DISTANCE);
  }

  private getHitDistance(hit: XrHitTestResult): number | null {
    if (Number.isFinite(hit.distance)) return hit.distance;
    return this.distanceFromCamera(this.toVector(hit));
  }

  private freezePosterTransform(group: THREE.Group): void {
    group.updateMatrix();
    group.updateMatrixWorld(true);
    group.matrixAutoUpdate = false;
  }

  private shouldUseEighthWall(): boolean {
    const userAgent = navigator.userAgent;
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
    return mobileUserAgent && navigator.maxTouchPoints > 0;
  }

  private setArMode(mode: '8thwall' | 'fallback'): void {
    const screen = this.root?.querySelector<HTMLElement>('.ar-exhibit-page');
    if (screen) {
      screen.dataset.arMode = mode;
      screen.dataset.posterWorldScale = mode === '8thwall' ? 'absolute' : 'fallback';
    }
  }

  private setAnchorState(locked: boolean, mode: string): void {
    this.anchorLocked = locked;
    const screen = this.root?.querySelector<HTMLElement>('.ar-exhibit-page');
    if (!screen) return;
    screen.dataset.posterAnchorLocked = locked ? 'true' : 'false';
    screen.dataset.posterAnchorMode = mode;
    screen.dataset.posterPlacementBusy = locked ? 'false' : 'true';
    if (this.group) {
      screen.dataset.posterAnchorX = this.group.position.x.toFixed(3);
      screen.dataset.posterAnchorY = this.group.position.y.toFixed(3);
      screen.dataset.posterAnchorZ = this.group.position.z.toFixed(3);
      screen.dataset.posterVisible = this.group.visible ? 'true' : 'false';
      screen.dataset.posterWallAttached = locked && mode.startsWith('hittest:') ? 'true' : 'false';
      screen.dataset.posterCount = String(this.group.userData.posterCount ?? 0);
      screen.dataset.posterGalleryMode = String(this.group.userData.mode ?? '');
      screen.dataset.posterLineWidth = Number(this.group.userData.lineWidth ?? 0).toFixed(3);
      screen.dataset.posterAnchorSamples = String(this.hitSamples.length);
      screen.dataset.posterRepositionCount = String(this.repositionCount);
      screen.dataset.posterAnchorDistance = this.getPosterAnchorDistance();
      screen.dataset.posterTrackingStatus = this.xrTrackingStatus;
    }
    this.updatePlacementUi(locked, mode);
    if (locked) this.updateWorldTrackedDebug(true);
  }

  private updateWorldTrackedDebug(force = false): void {
    if (!this.anchorLocked || !this.group || !this.xrCamera) return;
    const now = performance.now();
    if (!force && now - this.lastWorldDebugMs < PosterExhibitPage.DEBUG_STATE_INTERVAL_MS) {
      return;
    }
    this.lastWorldDebugMs = now;

    const screen = this.root?.querySelector<HTMLElement>('.ar-exhibit-page');
    if (!screen) return;
    screen.dataset.posterAnchorDistance = this.getPosterAnchorDistance();

    const bounds = this.getPosterScreenBounds(this.xrCamera);
    if (!bounds) return;
    screen.dataset.posterScreenWidthPx = String(Math.round(bounds.width));
    screen.dataset.posterScreenHeightPx = String(Math.round(bounds.height));
    screen.dataset.posterScreenCenterX = String(Math.round(bounds.centerX));
    screen.dataset.posterScreenCenterY = String(Math.round(bounds.centerY));
    screen.dataset.posterPerspectiveRatio = (bounds.height / Math.max(1, window.innerHeight)).toFixed(4);
  }

  private getPosterScreenBounds(
    camera: THREE.Camera,
  ): { width: number; height: number; centerX: number; centerY: number } | null {
    if (!this.group || !this.xrCanvas) return null;
    const box = new THREE.Box3().setFromObject(this.group);
    if (box.isEmpty()) return null;

    const canvas = this.xrCanvas;
    const viewportWidth = canvas.clientWidth || canvas.width || window.innerWidth;
    const viewportHeight = canvas.clientHeight || canvas.height || window.innerHeight;
    const { min, max } = box;
    const corners = [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, max.z),
    ];

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    corners.forEach((corner) => {
      const projected = corner.project(camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return;
      const x = ((projected.x + 1) / 2) * viewportWidth;
      const y = ((1 - projected.y) / 2) * viewportHeight;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    });

    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      return null;
    }
    return {
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    };
  }

  private updatePlacementUi(locked: boolean, mode: string): void {
    const busy = !locked;
    const label = this.getPlacementLoadingLabel(mode);
    if (this.loadingEl) {
      this.loadingEl.dataset.visible = busy ? 'true' : 'false';
      const text = this.loadingEl.querySelector<HTMLElement>('.ar-anchor-loading__text');
      if (text) text.textContent = label;
    }
    if (this.repositionBtn) {
      this.repositionBtn.disabled = busy;
      this.repositionBtn.textContent = busy ? label : '재배치';
    }
  }

  private getPlacementLoadingLabel(mode: string): string {
    if (mode === 'xr-repositioning') return '재배치 중...';
    if (mode === 'hittest-waiting') return '벽면 찾는 중...';
    if (mode.startsWith('hittest-stabilizing')) return '고정 중...';
    if (mode.startsWith('tracking:')) return '추적 중...';
    return '배치 중...';
  }

  private setPlacementHint(text: string): void {
    if (this.hintEl) this.hintEl.textContent = text;
  }

  private getPosterAnchorDistance(): string {
    if (!this.group) return '';
    const distance = this.distanceFromCamera(this.group.position);
    return distance === null ? '' : distance.toFixed(3);
  }

  private clearAnchorFallbackTimer(): void {
    if (this.anchorFallbackTimer === null) return;
    window.clearTimeout(this.anchorFallbackTimer);
    this.anchorFallbackTimer = null;
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
    this.clearAnchorFallbackTimer();
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
    if (this.ownsRenderer) this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.xrCanvas?.remove();
    this.renderer = null;
    this.ownsRenderer = false;
    this.scene = null;
    this.camera = null;
    this.xrCamera = null;
    this.xrCanvas = null;
    this.root = null;
    this.hintEl = null;
    this.loadingEl = null;
    this.repositionBtn = null;
  }
}
