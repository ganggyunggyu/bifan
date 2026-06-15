import * as THREE from 'three';
import type { ExhibitSlot } from '../store/appState';
import { COLORS } from '../config/appConfig';

/**
 * 포스터 AR 전시 관리자 (FS-006, Screen 11).
 *
 * - 전시대 총 20개 슬롯을 사용자 주변 원형(ring)으로 배치.
 * - 빈 슬롯 있으면 랜덤 배치, 가득 차면 가장 오래된(timestamp 최소) 슬롯 대체.
 * - 본인 포스터는 아웃글로우(테두리 발광) 효과.
 * - 임시로 localStorage에 상태 저장(서버 동기화 미정, 미결 #12).
 *
 * 렌더링은 8th Wall(XR8.Threejs) 씬이든 폴백 Three.js 씬이든 동일하게
 * `buildGroup()`이 만든 THREE.Group을 scene에 add 하면 됩니다.
 */
const SLOT_COUNT = 20;
const RING_RADIUS = 2.4; // m
const POSTER_WIDTH = 0.62; // m (9:16 → 높이 ≈ 1.1m)
const POSTER_ASPECT = 3 / 2; // 2:3 포스터
const EYE_HEIGHT = 0; // 카메라 원점 기준 높이
const STORAGE_KEY = 'bifan.exhibit.slots.v1';

export class PosterExhibitManager {
  private slots: ExhibitSlot[];
  private mySlotId: number | null = null;
  private nowSeq: number; // Date.now 사용 불가 환경 대비, 단조 증가 시퀀스

  constructor() {
    this.slots = this.load();
    // timestamp 최대값 + 1에서 시퀀스 시작(대체 정책 일관성 유지).
    this.nowSeq = this.slots.reduce((m, s) => Math.max(m, s.timestamp), 0) + 1;
  }

  get allSlots(): ReadonlyArray<ExhibitSlot> {
    return this.slots;
  }
  get myPosterSlotId(): number | null {
    return this.mySlotId;
  }

  /**
   * 내 포스터를 전시대에 부착하고 슬롯 id를 반환.
   * 1) 빈 슬롯 존재 → 랜덤 빈 슬롯
   * 2) 만석 → 가장 오래된 슬롯 대체
   */
  placeMyPoster(posterImageUrl: string, rand: () => number = pseudoRandom()): number {
    const empties = this.slots.filter((s) => !s.occupied);
    let target: ExhibitSlot;
    if (empties.length > 0) {
      target = empties[Math.floor(rand() * empties.length)];
    } else {
      target = this.slots.reduce((oldest, s) =>
        s.timestamp < oldest.timestamp ? s : oldest,
      );
    }
    target.occupied = true;
    target.posterImageUrl = posterImageUrl;
    target.timestamp = this.nowSeq++;
    this.mySlotId = target.id;
    this.save();
    return target.id;
  }

  /** 슬롯의 월드 좌표(원형 배치). */
  slotPosition(id: number): THREE.Vector3 {
    const angle = (id / SLOT_COUNT) * Math.PI * 2;
    return new THREE.Vector3(
      Math.sin(angle) * RING_RADIUS,
      EYE_HEIGHT,
      -Math.cos(angle) * RING_RADIUS,
    );
  }

  /**
   * 점유된 슬롯들의 포스터 평면을 담은 그룹을 생성.
   * 본인 포스터는 발광 테두리(아웃글로우)를 추가.
   */
  buildGroup(): THREE.Group {
    const group = new THREE.Group();
    const loader = new THREE.TextureLoader();
    const h = POSTER_WIDTH * POSTER_ASPECT;

    for (const slot of this.slots) {
      if (!slot.occupied || !slot.posterImageUrl) continue;
      const pos = this.slotPosition(slot.id);
      const isMine = slot.id === this.mySlotId;

      // 아웃글로우: 본인 포스터 뒤에 살짝 큰 발광 평면.
      if (isMine) {
        const glowGeo = new THREE.PlaneGeometry(POSTER_WIDTH * 1.16, h * 1.12);
        const glowMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(COLORS.bifanBlue),
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
        });
        const glow = new THREE.Mesh(glowGeo, glowMat);
        glow.position.copy(pos);
        glow.lookAt(0, EYE_HEIGHT, 0);
        glow.translateZ(-0.01); // 포스터 뒤로 살짝 밀어 z-fighting 방지
        glow.renderOrder = 0;
        group.add(glow);
      }

      const tex = loader.load(slot.posterImageUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      const geo = new THREE.PlaneGeometry(POSTER_WIDTH, h);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.lookAt(0, EYE_HEIGHT, 0);
      mesh.renderOrder = 1;
      group.add(mesh);
    }

    return group;
  }

  /**
   * buildGroup()이 만든 그룹의 GPU 리소스(지오메트리/머티리얼/텍스처)를 해제.
   * WebGLRenderer.dispose()는 업로드된 텍스처/지오메트리를 풀어주지 않으므로,
   * 페이지 unmount 시 반드시 호출해 GPU 메모리 누수를 방지한다.
   */
  disposeGroup(group: THREE.Group): void {
    group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.MeshBasicMaterial | undefined;
      if (mat) {
        mat.map?.dispose();
        mat.dispose();
      }
    });
    group.clear();
  }

  // ---------- 영속화 ----------

  private load(): ExhibitSlot[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ExhibitSlot[];
        if (Array.isArray(parsed) && parsed.length === SLOT_COUNT) return parsed;
      }
    } catch {
      /* 파싱 실패 시 초기화 */
    }
    return Array.from({ length: SLOT_COUNT }, (_, id) => ({
      id,
      occupied: false,
      posterImageUrl: null,
      timestamp: 0,
    }));
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.slots));
    } catch (err) {
      // dataURL 20개가 쿼터를 초과할 수 있음 → 서버 연동 전까지는 무시.
      console.warn('[PosterExhibitManager] localStorage save failed (quota?)', err);
    }
  }
}

/** Date.now/Math.random 의존 없이 호출별로 변하는 간이 난수기. */
function pseudoRandom(): () => number {
  let seed = 0x2545f491;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return ((seed >>> 0) % 100000) / 100000;
  };
}
