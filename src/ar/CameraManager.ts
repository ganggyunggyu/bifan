/**
 * 공유 카메라 매니저 (싱글톤).
 *
 * 페이지마다 getUserMedia를 호출하면 환경(특히 인앱 브라우저)에서 매번 권한
 * 프롬프트가 뜰 수 있습니다. 앱 세션 동안 **단 한 번** 카메라를 확보하고,
 * 모든 AR 화면이 같은 MediaStream을 재사용하도록 합니다.
 *
 * 한 MediaStream은 여러 <video>에 동시에 연결할 수 있으므로, 각 페이지는
 * 자신의 <video>에 stream을 attach만 하고 트랙은 멈추지 않습니다.
 * 실제 트랙 정지는 release() 호출 시(앱 종료 등)에만 일어납니다.
 */
export type CameraFacing = 'environment' | 'user';

export interface CameraAcquireOptions {
  /**
   * false면 브라우저 권한 팝업을 새로 띄울 수 있는 getUserMedia 호출을 피합니다.
   * 이미 권한이 granted이거나 공유 스트림이 있을 때만 연결합니다.
   */
  allowPrompt?: boolean;
}

const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30, max: 30 },
} satisfies MediaTrackConstraints;

class CameraManager {
  private stream: MediaStream | null = null;
  private pending: Promise<MediaStream | null> | null = null;
  private facing: CameraFacing = 'environment';
  private pendingFacing: CameraFacing | null = null;
  private lastPermissionState: PermissionState | null = null;

  /** 현재 사용 중인 카메라 방향. */
  get currentFacing(): CameraFacing {
    return this.facing;
  }

  /**
   * 공유 스트림을 확보. facing(전/후면)이 같으면 재사용, 다르면 전환합니다.
   * 권한은 origin 단위라 최초 1회만 묻고, 전/후면 전환 시엔 다시 묻지 않습니다.
   */
  async acquire(
    facing: CameraFacing = 'environment',
    options: CameraAcquireOptions = {},
  ): Promise<MediaStream | null> {
    const allowPrompt = options.allowPrompt ?? true;
    if (this.stream && this.stream.active && this.facing === facing) {
      return this.stream;
    }
    if (this.pending && this.pendingFacing === facing) return this.pending;

    if (!navigator.mediaDevices?.getUserMedia) {
      return null;
    }

    if (!allowPrompt) {
      const permission = await this.queryPermission();
      if (permission !== 'granted') return null;
    }

    // 방향이 다르면 기존 스트림을 정지하고 새로 확보.
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }

    this.pendingFacing = facing;
    this.pending = navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: facing },
          ...VIDEO_CONSTRAINTS,
        },
        audio: false,
      })
      .then((s) => {
        this.stream = s;
        this.facing = facing;
        this.lastPermissionState = 'granted';
        this.pending = null;
        this.pendingFacing = null;
        return s;
      })
      .catch((err) => {
        console.warn('[CameraManager] camera unavailable', err);
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          this.lastPermissionState = 'denied';
        }
        this.pending = null;
        this.pendingFacing = null;
        return null;
      });
    return this.pending;
  }

  /** 확보된 스트림을 video에 연결. 스트림 없으면 false. */
  attachTo(video: HTMLVideoElement): boolean {
    if (!this.stream) return false;
    video.setAttribute('playsinline', '');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.srcObject = this.stream;
    void video.play().catch(() => undefined);
    return true;
  }

  async play(video: HTMLVideoElement): Promise<boolean> {
    try {
      await video.play();
      return true;
    } catch (err) {
      console.warn('[CameraManager] video playback failed', err);
      return false;
    }
  }

  get active(): boolean {
    return !!this.stream && this.stream.active;
  }

  async permissionState(): Promise<PermissionState | null> {
    return this.queryPermission();
  }

  /** 트랙을 완전히 정지(앱 종료/카메라 완전 해제 시에만). */
  release(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.pending = null;
    this.pendingFacing = null;
  }

  private async queryPermission(): Promise<PermissionState | null> {
    try {
      if (!navigator.permissions?.query) return this.lastPermissionState;
      const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
      this.lastPermissionState = status.state;
      status.onchange = () => {
        this.lastPermissionState = status.state;
      };
      return status.state;
    } catch {
      return this.lastPermissionState;
    }
  }
}

export const cameraManager = new CameraManager();

export function getDefaultArCameraFacing(): CameraFacing {
  if (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) {
    return 'environment';
  }
  return 'user';
}
