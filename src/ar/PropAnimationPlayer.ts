import * as THREE from 'three';
import { ANIMATION_ASPECT, ANIMATION_TOTAL_MS } from '../config/arConfig';
import { cachedUrl } from '../utils/assetPreloader';

/**
 * Module A 프랍 애니메이션 재생기.
 *
 * 사전 렌더링된 mp4를 Three.js VideoTexture로 받아 평면(plane) 메시에 입혀
 * 인식된 구조물 위치에 앵커링하여 재생합니다 (FS-003).
 *
 * 두 가지 모드:
 *  1) 8th Wall 연동: `attachToEighthWall(scene)`로 외부 XR8.Threejs 씬에 plane을
 *     추가하고, 이미지 타겟 pose(xrimageupdated)로 plane.matrix를 갱신합니다.
 *  2) dev 프리뷰: `mountPreview(container)`로 자체 렌더러를 생성해 카메라 정면에
 *     plane을 띄웁니다. 8th Wall 키/타겟이 없는 단계에서 렌더 파이프라인 검증용.
 */
export interface PropAnimationCallbacks {
  onEnded: () => void;
  onError?: (err: unknown) => void;
}

export class PropAnimationPlayer {
  private video: HTMLVideoElement;
  private texture: THREE.VideoTexture;
  private mesh: THREE.Mesh;
  private callbacks: PropAnimationCallbacks;

  // dev 프리뷰 전용 컨텍스트.
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private rafId = 0;
  private resizeBound = () => this.onResize();
  private fallbackTimer: number | null = null;
  private endHandled = false;

  constructor(videoUrl: string, callbacks: PropAnimationCallbacks) {
    this.callbacks = callbacks;

    this.video = document.createElement('video');
    // 사전 다운로드된 blob이 있으면 그걸로 재생(네트워크 끊김 방지).
    this.video.src = cachedUrl(videoUrl);
    this.video.crossOrigin = 'anonymous';
    this.video.setAttribute('playsinline', '');
    this.video.preload = 'auto';
    // 모바일 자동재생 정책상 muted가 필요할 수 있으나, 본 콘텐츠는 사용자
    // 인터랙션(인식) 직후 재생되므로 소리를 유지합니다. 실패 시 폴백에서 음소거.
    this.video.muted = false;

    this.texture = new THREE.VideoTexture(this.video);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    // 16:9 평면. 폭 1 기준, 높이 = 1/aspect.
    const geometry = new THREE.PlaneGeometry(1, 1 / ANIMATION_ASPECT);
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);

    this.video.addEventListener('ended', () => this.handleEnded());
  }

  /** 영상 plane (8th Wall 씬에 직접 add 하거나 앵커 그룹에 붙일 수 있음). */
  get object3D(): THREE.Object3D {
    return this.mesh;
  }

  /**
   * 재생 시작. 자동재생이 막히면 음소거 후 재시도합니다.
   */
  async play(): Promise<void> {
    this.mesh.visible = true; // 앵커 모드에서 재생 시점에 노출.
    this.armFallbackTimer();
    try {
      await this.video.play();
    } catch {
      this.video.muted = true;
      try {
        await this.video.play();
      } catch (err) {
        this.callbacks.onError?.(err);
        // 재생 자체가 불가하면 종료 콜백으로 흐름을 막지 않음.
        this.handleEnded();
      }
    }
  }

  // ---------- 8th Wall 연동 모드 ----------

  /**
   * 외부(XR8.Threejs) 씬에 plane을 추가합니다.
   * 이후 `updateAnchorPose`를 이미지 타겟 이벤트마다 호출하세요.
   */
  attachToEighthWall(scene: THREE.Scene): void {
    this.mesh.visible = false; // 인식·재생 전까지 숨김.
    scene.add(this.mesh);
  }

  /**
   * 이미지 타겟 pose로 plane을 배치합니다 (xrimagefound/xrimageupdated detail).
   * @param position 월드 좌표
   * @param quaternion 회전
   * @param widthMeters 타겟 실제 가로 폭(미터). plane을 이 폭에 맞춰 스케일.
   */
  updateAnchorPose(
    position: THREE.Vector3Like,
    quaternion: THREE.QuaternionLike,
    widthMeters: number,
  ): void {
    this.mesh.position.set(position.x, position.y, position.z);
    this.mesh.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    this.mesh.scale.set(widthMeters, widthMeters, 1);
  }

  // ---------- dev 프리뷰 모드 ----------

  /**
   * 8th Wall 없이 자체 렌더러로 카메라 정면에 plane을 띄웁니다.
   * 투명 배경이라 하위 카메라 피드 위에 오버레이됩니다.
   */
  mountPreview(container: HTMLElement): void {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.01,
      100,
    );
    camera.position.set(0, 0, 1.4);
    scene.add(this.mesh);

    this.scene = scene;
    this.camera = camera;
    // 16:9 영상이 잘리지 않도록 뷰포트에 맞춰 contain 스케일 적용.
    this.fitPlane();

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    window.addEventListener('resize', this.resizeBound);
    this.renderLoop();
  }

  private renderLoop = (): void => {
    this.rafId = requestAnimationFrame(this.renderLoop);
    if (this.renderer && this.scene && this.camera) {
      // 살짝 떠다니는 느낌의 미세 회전(프리뷰 한정 시각 효과).
      this.renderer.render(this.scene, this.camera);
    }
  };

  private onResize(): void {
    if (!this.renderer || !this.camera) return;
    const el = this.renderer.domElement.parentElement;
    if (!el) return;
    this.camera.aspect = el.clientWidth / el.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(el.clientWidth, el.clientHeight);
    this.fitPlane();
  }

  /**
   * 영상 plane을 현재 뷰포트에 'contain'으로 맞춥니다.
   * 16:9 영상을 세로 화면에 띄워도 좌우/상하가 잘리지 않고 전체가 보입니다
   * (가로가 더 좁으면 가로 기준으로 맞추고 위아래는 레터박스).
   */
  private fitPlane(): void {
    if (!this.camera) return;
    const cam = this.camera;
    const distance = cam.position.z; // plane은 z=0
    const visibleHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const visibleWidth = visibleHeight * cam.aspect;

    // plane 원본 크기: width 1, height 1/ANIMATION_ASPECT
    const planeW = 1;
    const planeH = 1 / ANIMATION_ASPECT;
    const scale = Math.min(visibleWidth / planeW, visibleHeight / planeH) * 0.96;
    this.mesh.scale.set(scale, scale, 1);
  }

  // ---------- 공통 ----------

  private armFallbackTimer(): void {
    // onended가 누락될 경우를 대비한 안전 타임아웃 (재생시간 + 여유).
    this.fallbackTimer = window.setTimeout(
      () => this.handleEnded(),
      ANIMATION_TOTAL_MS + 1500,
    );
  }

  private handleEnded(): void {
    if (this.endHandled) return;
    this.endHandled = true;
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    this.callbacks.onEnded();
  }

  dispose(): void {
    if (this.fallbackTimer !== null) clearTimeout(this.fallbackTimer);
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resizeBound);

    this.video.pause();
    this.video.removeAttribute('src');
    this.video.load();

    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();

    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
