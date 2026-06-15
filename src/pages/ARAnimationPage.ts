import type { Page } from './Page';
import { ImageTargetTracker } from '../ar/ImageTargetTracker';
import { PropAnimationPlayer } from '../ar/PropAnimationPlayer';
import { showToast } from '../components/Toast';
import { router, ROUTES } from '../utils/router';
import { MODULE_A_VIDEO } from '../config/arConfig';

/**
 * [Module A — Screen 6] 3D 프랍 애니메이션 재생 (FS-003).
 *
 * 인식된 구조물 위치에 mp4 영상을 AR 앵커링하여 재생합니다.
 * 8th Wall 앱 키/이미지 타겟이 준비되면 8th Wall 모드로 동작하고,
 * 그 전까지는 dev 프리뷰 모드(카메라 피드 위 영상 plane 오버레이)로 검증합니다.
 *
 * 재생 종료 → 페이드아웃 → Module B(AI 포스터) 진입 (Phase 2/3).
 */
export class ARAnimationPage implements Page {
  private tracker = new ImageTargetTracker();
  private player: PropAnimationPlayer | null = null;
  private root!: HTMLElement;
  private disposed = false;
  private endTimer: number | null = null;

  async mount(root: HTMLElement): Promise<void> {
    this.root = root;
    const screen = document.createElement('div');
    screen.className = 'screen ar-animation-page';

    // 카메라 뷰 레이어 (8th Wall이면 XR8가 이 위에 렌더; dev면 getUserMedia 피드).
    const view = document.createElement('div');
    view.className = 'ar-view';
    screen.appendChild(view);

    // Three.js 영상 plane이 올라갈 오버레이 컨테이너.
    const stage = document.createElement('div');
    stage.className = 'ar-stage';
    screen.appendChild(stage);

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
      onEnded: () => this.onAnimationEnded(),
      onError: (err) => {
        console.error('[ARAnimationPage] video error', err);
        showToast('애니메이션을 재생할 수 없습니다.');
        this.onAnimationEnded();
      },
    });

    // TODO(8th Wall): XR8 준비 시 attachToEighthWall(scene) + updateAnchorPose로 교체.
    this.player.mountPreview(stage);
    void this.player.play();
  }

  private onAnimationEnded(): void {
    // 페이드아웃 후 로딩(300ms) → 30주년 감사 메시지.
    this.root.querySelector('.ar-animation-page')?.classList.add('is-fading');
    this.endTimer = window.setTimeout(() => router.navigate(ROUTES.messageIntro), 700);
  }

  unmount(): void {
    this.disposed = true;
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.player?.dispose();
    this.player = null;
    this.tracker.stop();
  }
}
