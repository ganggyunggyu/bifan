/**
 * 일반 카메라 트래커.
 *
 * Module B 포스터 촬영/전시처럼 8th Wall이 아닌 화면에서 getUserMedia
 * 카메라 피드를 띄울 때 사용합니다.
 */
import { cameraManager, type CameraFacing } from './CameraManager';

export type TargetEvent = 'found' | 'lost';
type Handler = () => void;

export interface CameraStartResult {
  video: HTMLVideoElement;
  /** 실제 카메라 스트림 확보 여부. false면 카메라 미사용(플레이스홀더 배경). */
  hasStream: boolean;
}

export class ImageTargetTracker {
  private handlers: Record<TargetEvent, Set<Handler>> = {
    found: new Set(),
    lost: new Set(),
  };
  private video: HTMLVideoElement | null = null;
  private boundXrFound = () => this.emit('found');
  private boundXrLost = () => this.emit('lost');
  private usingEighthWall = false;

  on(event: TargetEvent, handler: Handler): void {
    this.handlers[event].add(handler);
  }

  /**
   * 후면 카메라 피드를 시작합니다(공유 스트림 재사용 → 권한 1회).
   * 실패 시 hasStream=false.
   */
  async startCamera(facing: CameraFacing = 'environment'): Promise<CameraStartResult> {
    const video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.muted = true;
    video.autoplay = true;
    this.video = video;

    const stream = await cameraManager.acquire(facing);
    if (stream && cameraManager.attachTo(video)) {
      return { video, hasStream: true };
    }
    return { video, hasStream: false };
  }

  /** 전/후면 전환. 기존 video에 새 스트림을 다시 연결. 성공 시 true. */
  async switchCamera(facing: CameraFacing): Promise<boolean> {
    if (!this.video) return false;
    const stream = await cameraManager.acquire(facing);
    return !!stream && cameraManager.attachTo(this.video);
  }

  /** 레거시 호환용 이벤트 브리지. 현재 첫 플로우에서는 사용하지 않습니다. */
  attachEighthWall(): void {
    this.usingEighthWall = true;
    window.addEventListener('xrimagefound', this.boundXrFound);
    window.addEventListener('xrimagelost', this.boundXrLost);
  }

  /** [MOCK 전용] 인식/소실을 수동으로 트리거 (Phase 1 UI 검증용). */
  mockFound(): void {
    if (!this.usingEighthWall) this.emit('found');
  }
  mockLost(): void {
    if (!this.usingEighthWall) this.emit('lost');
  }

  private emit(event: TargetEvent): void {
    this.handlers[event].forEach((h) => h());
  }

  stop(): void {
    window.removeEventListener('xrimagefound', this.boundXrFound);
    window.removeEventListener('xrimagelost', this.boundXrLost);
    // 공유 스트림은 멈추지 않고 video만 분리(다른 화면에서 재사용 → 권한 재요청 방지).
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.handlers.found.clear();
    this.handlers.lost.clear();
  }
}
