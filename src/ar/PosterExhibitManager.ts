import * as THREE from 'three';
import { COLORS } from '../config/appConfig';
import type { ExhibitSlot } from '../store/appState';

/**
 * 포스터 AR 전시 관리자 (FS-006, Screen 11).
 *
 * localStorage에 저장된 전시 포스터를 정면 일렬 갤러리로 배치합니다.
 * 현재 생성된 포스터는 전시 진입 시 슬롯에 저장하고, 가장 최근 포스터를 강조합니다.
 *
 * 렌더링은 Module B 전시 화면의 Three.js 씬에 `buildPosterLineGroup()`이 만든
 * THREE.Group을 add 하는 방식으로 처리합니다.
 */
const STORAGE_KEY = 'bifan.exhibit.slots.v1';
const SLOT_COUNT = 20;
const POSTER_DISTANCE = 2.8; // m
const POSTER_MAX_WIDTH = 0.58; // m
const POSTER_MIN_WIDTH = 0.24; // m
const POSTER_ASPECT = 3 / 2; // 2:3 포스터
const POSTER_GAP = 0.14; // m
const LINE_MAX_WIDTH = 4.6; // m

export class PosterExhibitManager {
  private slots: ExhibitSlot[];
  private mySlotId: number | null = null;
  private nowSeq: number;

  constructor() {
    this.slots = this.load();
    this.nowSeq = this.slots.reduce((max, slot) => Math.max(max, slot.timestamp), 0) + 1;
  }

  get fallbackDistance(): number {
    return POSTER_DISTANCE;
  }

  get allSlots(): ReadonlyArray<ExhibitSlot> {
    return this.slots;
  }

  get visibleSlots(): ReadonlyArray<ExhibitSlot> {
    return this.slots
      .filter((slot) => slot.occupied && !!slot.posterImageUrl)
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-SLOT_COUNT);
  }

  get myPosterSlotId(): number | null {
    return this.mySlotId;
  }

  /**
   * 현재 생성된 포스터를 전시 슬롯에 저장합니다.
   * 같은 dataURL이 이미 있으면 중복 생성 대신 최신 포스터로 다시 표시합니다.
   */
  placeMyPoster(posterImageUrl: string): number {
    const existing = this.slots.find(
      (slot) => slot.occupied && slot.posterImageUrl === posterImageUrl,
    );
    const target = existing ?? this.getEmptySlot() ?? this.getOldestSlot();

    target.occupied = true;
    target.posterImageUrl = posterImageUrl;
    target.timestamp = this.nowSeq++;
    this.mySlotId = target.id;
    this.save();
    return target.id;
  }

  /**
   * localStorage에 저장된 전시 포스터를 일렬 갤러리 그룹으로 생성합니다.
   * 그룹 원점이 줄의 중앙이고, 호출자가 월드 좌표/회전을 고정합니다.
   */
  buildPosterLineGroup(): THREE.Group {
    const group = new THREE.Group();
    const loader = new THREE.TextureLoader();
    const slots = this.visibleSlots;
    const posterCount = slots.length;
    const posterWidth = this.getPosterWidth(posterCount);
    const posterHeight = posterWidth * POSTER_ASPECT;
    const pitch = posterWidth + POSTER_GAP;
    const startX = -((posterCount - 1) * pitch) / 2;
    const lineWidth = posterCount > 0 ? posterWidth * posterCount + POSTER_GAP * (posterCount - 1) : 0;

    group.userData.posterCount = posterCount;
    group.userData.mode = 'linear-local-storage-gallery';
    group.userData.slotIds = slots.map((slot) => slot.id);
    group.userData.posterWidth = posterWidth;
    group.userData.lineWidth = lineWidth;

    slots.forEach((slot, index) => {
      if (!slot.posterImageUrl) return;
      const poster = this.buildPosterPlane(
        loader,
        slot.posterImageUrl,
        posterWidth,
        posterHeight,
        slot.id === this.mySlotId,
      );
      poster.name = `ai-poster-slot-${slot.id}`;
      poster.position.x = startX + index * pitch;
      poster.userData.slotId = slot.id;
      group.add(poster);
    });

    return group;
  }

  private buildPosterPlane(
    loader: THREE.TextureLoader,
    posterImageUrl: string,
    width: number,
    height: number,
    highlighted: boolean,
  ): THREE.Group {
    const poster = new THREE.Group();

    if (highlighted) {
      const glowGeo = new THREE.PlaneGeometry(width * 1.16, height * 1.12);
      const glowMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(COLORS.bifanBlue),
        transparent: true,
        opacity: 0.86,
        side: THREE.DoubleSide,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.name = 'ai-poster-glow';
      glow.translateZ(-0.018);
      glow.renderOrder = 0;
      poster.add(glow);
    }

    const tex = loader.load(posterImageUrl);
    tex.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(width, height);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ai-poster-image';
    mesh.renderOrder = 1;
    poster.add(mesh);

    return poster;
  }

  /**
   * buildPosterLineGroup()이 만든 그룹의 GPU 리소스(지오메트리/머티리얼/텍스처)를 해제.
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

  private getPosterWidth(count: number): number {
    if (count <= 1) return POSTER_MAX_WIDTH;
    const widthByLine = (LINE_MAX_WIDTH - POSTER_GAP * (count - 1)) / count;
    return THREE.MathUtils.clamp(widthByLine, POSTER_MIN_WIDTH, POSTER_MAX_WIDTH);
  }

  private getEmptySlot(): ExhibitSlot | null {
    return this.slots.find((slot) => !slot.occupied) ?? null;
  }

  private getOldestSlot(): ExhibitSlot {
    return this.slots.reduce((oldest, slot) =>
      slot.timestamp < oldest.timestamp ? slot : oldest,
    );
  }

  private load(): ExhibitSlot[] {
    const slots = this.createEmptySlots();
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return slots;
      const parsed = JSON.parse(raw) as ExhibitSlot[];
      if (!Array.isArray(parsed)) return slots;

      parsed.forEach((slot) => {
        if (!Number.isInteger(slot?.id) || slot.id < 0 || slot.id >= SLOT_COUNT) return;
        const target = slots[slot.id];
        target.occupied = !!slot.occupied && typeof slot.posterImageUrl === 'string';
        target.posterImageUrl = target.occupied ? slot.posterImageUrl : null;
        target.timestamp = Number.isFinite(slot.timestamp) ? slot.timestamp : 0;
      });
    } catch {
      return slots;
    }
    return slots;
  }

  private save(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.slots));
    } catch (err) {
      console.warn('[PosterExhibitManager] localStorage save failed', err);
    }
  }

  private createEmptySlots(): ExhibitSlot[] {
    return Array.from({ length: SLOT_COUNT }, (_, id) => ({
      id,
      occupied: false,
      posterImageUrl: null,
      timestamp: 0,
    }));
  }
}
