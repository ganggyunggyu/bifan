import * as THREE from 'three';

/**
 * 8th Wall(오픈소스 엔진 바이너리) 컨트롤러.
 *
 * 8th Wall은 2026년 MIT 라이선스로 공개되어 앱 키 없이 무료 사용 가능합니다.
 * 엔진 바이너리(@8thwall/engine-binary, SLAM 포함)를 CDN으로 로드하고
 * Three.js 파이프라인으로 월드 트래킹 AR 씬을 구동합니다.
 *
 * API는 기존 8th Wall과 동일: XR8.addCameraPipelineModules / XR8.Threejs.pipelineModule
 * / XR8.XrController.pipelineModule / XR8.run.
 *
 * 참고: docs https://8thwall.org/docs/engine/overview
 */
const ENGINE_SRC =
  'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1/dist/xr.js';
const LOAD_TIMEOUT_MS = 7000;

export interface XrSceneRefs {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
}

export interface StartOptions {
  canvas: HTMLCanvasElement;
  /** Three.js 씬이 준비되면 호출(여기서 전시 그룹 등을 add). */
  onSceneReady: (refs: XrSceneRefs) => void;
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
        script.crossOrigin = 'anonymous';
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
      const sceneModule = {
        name: 'bifan-exhibit',
        onStart: () => {
          const refs = XR8.Threejs.xrScene() as XrSceneRefs;
          opts.onSceneReady(refs);
        },
      };

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule(), // 6DoF 월드 트래킹(SLAM)
        sceneModule,
      ]);

      XR8.run({ canvas: opts.canvas });
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
      const sceneModule = {
        name: 'bifan-structure',
        onStart: () => opts.onSceneReady(XR8.Threejs.xrScene() as XrSceneRefs),
      };

      XR8.addCameraPipelineModules([
        XR8.GlTextureRenderer.pipelineModule(),
        XR8.Threejs.pipelineModule(),
        XR8.XrController.pipelineModule({
          // 이미지 타겟 모드. 등록된 타겟 이름을 지정.
          imageTargets: [opts.targetName],
        }),
        sceneModule,
      ]);

      // 일부 버전은 run 이후 configure로 타겟을 갱신.
      XR8.XrController.configure?.({ imageTargets: [opts.targetName] });

      XR8.run({ canvas: opts.canvas });
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
    }
    this.started = false;
  }
}

export interface StartImageTargetOptions {
  canvas: HTMLCanvasElement;
  /** 인식할 이미지 타겟 이름(STRUCTURE_TARGET.name). */
  targetName: string;
  onSceneReady: (refs: XrSceneRefs) => void;
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

/** XR8 전역 타입(오픈소스 엔진은 d.ts 미제공 → 최소 형태만 선언). */
interface XR8Like {
  addCameraPipelineModules(modules: unknown[]): void;
  run(opts: { canvas: HTMLCanvasElement }): void;
  stop?(): void;
  Threejs: { pipelineModule(): unknown; xrScene(): unknown };
  GlTextureRenderer: { pipelineModule(): unknown };
  XrController: {
    pipelineModule(config?: { imageTargets?: string[] }): unknown;
    configure?(config: { imageTargets?: string[] }): void;
  };
}
