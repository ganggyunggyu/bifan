import * as THREE from 'three';

/**
 * 8th Wall(오픈소스 엔진 바이너리) 컨트롤러.
 *
 * 8th Wall 엔진 바이너리(SLAM 포함)를 로드하고 Three.js 파이프라인으로
 * 월드 트래킹 AR 씬을 구동합니다.
 *
 * API는 기존 8th Wall과 동일: XR8.addCameraPipelineModules / XR8.Threejs.pipelineModule
 * / XR8.XrController.pipelineModule / XR8.run.
 *
 * 참고: docs https://8thwall.org/docs/engine/overview
 */
const ENGINE_SRC = '/external/xr/xr.js';
const LOAD_TIMEOUT_MS = 10000;

export interface XrSceneRefs {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
}

export interface XrHitTestResult {
  type: 'FEATURE_POINT' | 'ESTIMATED_SURFACE' | 'DETECTED_SURFACE' | 'UNSPECIFIED' | string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  distance: number;
}

export interface StartOptions {
  canvas: HTMLCanvasElement;
  /** Three.js 씬이 준비되면 호출(여기서 전시 그룹 등을 add). */
  onSceneReady: (refs: XrSceneRefs) => void;
  /** XR8 CPU update hook. 트래킹 상태 디버깅/상태 반영용. */
  onUpdate?: (args: CameraPipelineUpdateArgs) => void;
  /** XR8 render hook. Three.js 씬 update를 XR8 프레임에 맞춰 실행. */
  onRender?: () => void;
  /** 월드 트래킹 스케일. AR 포스터처럼 실제 거리 원근감이 필요한 씬은 absolute 사용. */
  worldScale?: 'responsive' | 'absolute';
  /** 카메라 파이프라인 상태 변화. */
  onStatus?: (args: CameraPipelineStatusArgs) => void;
  /** 카메라 권한 거부/실패 등으로 시작 불가 시 호출. */
  onError?: (err: unknown) => void;
}

export class EighthWallController {
  private started = false;

  /** XR8 전역이 이미 로드되어 있는지. */
  static isLoaded(): boolean {
    return typeof window !== 'undefined' && !!(window as Window & { XR8?: unknown }).XR8;
  }

  /**
   * 엔진 바이너리를 CDN에서 동적 로드. 이미 로드돼 있으면 즉시 resolve.
   * 실패/타임아웃 시 null 반환(폴백 분기용).
   */
  static loadEngine(): Promise<unknown | null> {
    (window as Window & { THREE?: typeof THREE }).THREE ??= THREE;

    if (EighthWallController.isLoaded()) {
      return Promise.resolve((window as Window & { XR8?: unknown }).XR8);
    }
    return new Promise((resolve) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-bifan-xr8]',
      );
      const settle = () => {
        const xr8 = (window as Window & { XR8?: unknown }).XR8;
        resolve(xr8 ?? null);
      };

      if (!existing) {
        const script = document.createElement('script');
        script.src = ENGINE_SRC;
        script.async = true;
        // SLAM(월드 트래킹) 청크 미리 로드.
        script.setAttribute('data-preload-chunks', 'slam');
        script.setAttribute('data-bifan-xr8', '');
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
      }

      // 'xrloaded' 이벤트 또는 window.XR8 등장까지 폴링.
      let waited = 0;
      const iv = window.setInterval(() => {
        if (EighthWallController.isLoaded()) {
          clearInterval(iv);
          settle();
        } else if ((waited += 200) >= LOAD_TIMEOUT_MS) {
          clearInterval(iv);
          resolve(null);
        }
      }, 200);
      window.addEventListener(
        'xrloaded',
        () => {
          clearInterval(iv);
          settle();
        },
        { once: true },
      );
    });
  }

  /**
   * Three.js 월드 트래킹 파이프라인을 구성하고 실행.
   * @returns 시작 성공 여부
   */
  async start(opts: StartOptions): Promise<boolean> {
    const XR8 = (await EighthWallController.loadEngine()) as XR8Like | null;
    if (!XR8) {
      opts.onError?.(new Error('8th Wall engine failed to load'));
      return false;
    }

    try {
      await this.ensureSlamReady(XR8);
      this.resetPipeline(XR8);
      XR8.XrController?.configure?.({
        disableWorldTracking: false,
        enableWorldPoints: true,
        scale: opts.worldScale ?? 'responsive',
      });

      const sceneModule = {
        name: 'bifan-exhibit',
        onCameraStatusChange: (args: CameraPipelineStatusArgs) => {
          opts.onStatus?.(args);
        },
        onStart: () => {
          this.syncCanvasToHost(opts.canvas);
          const refs = XR8.Threejs.xrScene() as XrSceneRefs;
          opts.onSceneReady(refs);
        },
        onUpdate: (args: CameraPipelineUpdateArgs) => {
          this.syncCanvasToHost(opts.canvas);
          opts.onUpdate?.(args);
        },
        onRender: () => {
          this.syncCanvasToHost(opts.canvas);
          opts.onRender?.();
        },
      };
      const fullWindowCanvasModule = (window as Window & { XRExtras?: XRExtrasLike }).XRExtras
        ?.FullWindowCanvas?.pipelineModule();
      const xrControllerModule = XR8.XrController?.pipelineModule();

      if (!xrControllerModule) {
        throw new Error('8th Wall SLAM module is unavailable');
      }

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        xrControllerModule, // 6DoF 월드 트래킹(SLAM)
        ...(fullWindowCanvasModule ? [fullWindowCanvasModule] : []),
        sceneModule,
      ]);

      this.syncCanvasToHost(opts.canvas);
      XR8.run({
        canvas: opts.canvas,
        allowedDevices: XR8.XrConfig?.device?.().ANY,
      });
      this.started = true;
      return true;
    } catch (err) {
      opts.onError?.(err);
      return false;
    }
  }

  /**
   * 이미지 타겟(구조물) 인식 모드로 시작.
   * 인식 이벤트는 window의 'xrimagefound' / 'xrimageupdated' / 'xrimagelost' 로
   * 전달됩니다(event.detail.name === targetName 로 필터).
   *
   * @returns 시작 성공 여부
   */
  async startImageTarget(opts: StartImageTargetOptions): Promise<boolean> {
    const XR8 = (await EighthWallController.loadEngine()) as XR8Like | null;
    if (!XR8) {
      opts.onError?.(new Error('8th Wall engine failed to load'));
      return false;
    }

    try {
      await this.ensureSlamReady(XR8);
      this.resetPipeline(XR8);

      const sceneModule = {
        name: 'bifan-structure',
        onCameraStatusChange: (args: CameraPipelineStatusArgs) => {
          opts.onStatus?.(args);
        },
        onStart: () => {
          this.syncCanvasToHost(opts.canvas);
          opts.onSceneReady(XR8.Threejs.xrScene() as XrSceneRefs);
        },
        onUpdate: (args: CameraPipelineUpdateArgs) => {
          this.syncCanvasToHost(opts.canvas);
          opts.onUpdate?.(args);
        },
        onRender: () => {
          this.syncCanvasToHost(opts.canvas);
          opts.onRender?.();
        },
      };
      const fullWindowCanvasModule = (window as Window & { XRExtras?: XRExtrasLike }).XRExtras
        ?.FullWindowCanvas?.pipelineModule();
      const xrControllerModule = XR8.XrController?.pipelineModule({
        imageTargets: [opts.targetName],
      });

      if (!xrControllerModule) {
        throw new Error('8th Wall image target module is unavailable');
      }

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        xrControllerModule,
        ...(fullWindowCanvasModule ? [fullWindowCanvasModule] : []),
        sceneModule,
      ]);

      // 일부 버전은 run 이후 configure로 타겟을 갱신.
      XR8.XrController?.configure?.({ imageTargets: [opts.targetName] });

      this.syncCanvasToHost(opts.canvas);
      XR8.run({
        canvas: opts.canvas,
        allowedDevices: XR8.XrConfig?.device?.().ANY,
      });
      this.started = true;
      return true;
    } catch (err) {
      opts.onError?.(err);
      return false;
    }
  }

  stop(): void {
    const XR8 = (window as Window & { XR8?: XR8Like }).XR8;
    if (this.started && XR8) {
      try {
        XR8.stop?.();
      } catch {
        /* noop */
      }
      try {
        XR8.clearCameraPipelineModules?.();
      } catch {
        /* noop */
      }
    }
    this.started = false;
  }

  hitTest(
    x = 0.5,
    y = 0.5,
    includedTypes: string[] = ['FEATURE_POINT'],
  ): XrHitTestResult[] {
    const XR8 = (window as Window & { XR8?: XR8Like }).XR8;
    const hitTest = XR8?.XrController?.hitTest;
    if (!hitTest) return [];

    try {
      return hitTest(x, y, includedTypes).filter(isValidHitTestResult);
    } catch (err) {
      console.warn('[EighthWallController] hitTest failed', err);
      return [];
    }
  }

  private async ensureSlamReady(XR8: XR8Like): Promise<void> {
    if (XR8.XrController?.pipelineModule) return;
    await XR8.loadChunk?.('slam');
    if (!XR8.XrController?.pipelineModule) {
      throw new Error('8th Wall SLAM module failed to load');
    }
  }

  private resetPipeline(XR8: XR8Like): void {
    try {
      XR8.stop?.();
    } catch {
      /* noop */
    }
    try {
      XR8.clearCameraPipelineModules?.();
    } catch {
      /* noop */
    }
    this.started = false;
  }

  private syncCanvasToHost(canvas: HTMLCanvasElement): void {
    const host = canvas.parentElement ?? document.documentElement;
    const rect = host.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssHeight = Math.max(1, Math.round(rect.height || window.innerHeight));
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(cssWidth * pixelRatio);
    const pixelHeight = Math.round(cssHeight * pixelRatio);

    canvas.style.setProperty('position', 'absolute', 'important');
    canvas.style.setProperty('inset', '0', 'important');
    canvas.style.setProperty('width', '100%', 'important');
    canvas.style.setProperty('height', '100%', 'important');
    canvas.style.setProperty('display', 'block', 'important');

    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  }
}

export interface StartImageTargetOptions {
  canvas: HTMLCanvasElement;
  /** 인식할 이미지 타겟 이름(STRUCTURE_TARGET.name). */
  targetName: string;
  onSceneReady: (refs: XrSceneRefs) => void;
  onUpdate?: (args: CameraPipelineUpdateArgs) => void;
  onRender?: () => void;
  onStatus?: (args: CameraPipelineStatusArgs) => void;
  onError?: (err: unknown) => void;
}

/** xrimagefound/updated/lost 이벤트의 detail 구조(8th Wall 표준). */
export interface ImageTargetDetail {
  name: string;
  type: string;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  scale: number;
  /** 타겟 실제 가로/세로(미터, scale 반영). */
  scaledWidth?: number;
  scaledHeight?: number;
}

function isValidHitTestResult(hit: XrHitTestResult): boolean {
  return (
    !!hit &&
    Number.isFinite(hit.position?.x) &&
    Number.isFinite(hit.position?.y) &&
    Number.isFinite(hit.position?.z) &&
    Number.isFinite(hit.rotation?.x) &&
    Number.isFinite(hit.rotation?.y) &&
    Number.isFinite(hit.rotation?.z) &&
    Number.isFinite(hit.rotation?.w)
  );
}

/** XR8 전역 타입(오픈소스 엔진은 d.ts 미제공 → 최소 형태만 선언). */
interface XR8Like {
  addCameraPipelineModules(modules: unknown[]): void;
  clearCameraPipelineModules?(): void;
  run(opts: { canvas: HTMLCanvasElement; allowedDevices?: unknown }): void;
  stop?(): void;
  loadChunk?(chunk: 'slam' | 'face'): Promise<void>;
  Threejs: { pipelineModule(): unknown; xrScene(): unknown };
  GlTextureRenderer: { pipelineModule(): unknown };
  XrController?: {
    pipelineModule(config?: { imageTargets?: string[] }): unknown;
    configure?(config: {
      disableWorldTracking?: boolean;
      enableWorldPoints?: boolean;
      imageTargets?: string[];
      scale?: 'responsive' | 'absolute';
    }): void;
    hitTest?(x: number, y: number, includedTypes?: string[]): XrHitTestResult[];
  };
  XrConfig?: {
    device?(): {
      ANY: unknown;
    };
  };
}

interface XRExtrasLike {
  FullWindowCanvas?: {
    pipelineModule(): unknown;
  };
}

interface CameraPipelineStatusArgs {
  status: 'requesting' | 'hasStream' | 'hasVideo' | 'failed' | string;
  error?: unknown;
}

interface CameraPipelineUpdateArgs {
  processCpuResult?: {
    reality?: {
      trackingStatus?: 'NORMAL' | 'LIMITED' | 'NOT_AVAILABLE' | string;
      trackingStatusReason?: string;
    };
  };
}

declare global {
  interface Window {
    THREE?: typeof THREE;
  }
}
