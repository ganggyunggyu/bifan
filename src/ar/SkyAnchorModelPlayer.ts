import {
  AnimationMixer,
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  LoopOnce,
  Vector3,
  type AnimationAction,
  type AnimationClip as ThreeAnimationClip,
  type Scene,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  SKY_ANCHOR_MODEL_BATCH_HOLD_MS,
  SKY_ANCHOR_MODEL_BATCH_SIZE,
  SKY_ANCHOR_PROP_MODELS,
  type SkyAnchorPropModel,
} from '../config/arConfig';
import { cachedUrl } from '../utils/assetPreloader';

interface ModelItem {
  wrapper: Group;
  pivot: Group;
  importedScene: Group;
  actions: AnimationAction[];
  slot: Vector3;
  delay: number;
  started: boolean;
}

export interface SkyAnchorModelProgress {
  loaded: number;
  failed: number;
  total: number;
}

export interface SkyAnchorModelDebugState {
  activeBatch: number;
  totalBatches: number;
  visibleCount: number;
  loadedCount: number;
}

const BATCH_MODEL_SLOTS = [
  new Vector3(-0.36, 0.02, 0),
  new Vector3(0, 0.02, 0),
  new Vector3(0.36, 0.02, 0),
];
const TWO_MODEL_BATCH_SLOTS = [
  new Vector3(-0.18, 0.02, 0),
  new Vector3(0.18, 0.02, 0),
];
const MAX_SLOT_DRIFT_X = 0.08;
const MAX_SLOT_DRIFT_Y = 0.08;

function getBatchSlot(index: number): Vector3 {
  const batchStart = Math.floor(index / SKY_ANCHOR_MODEL_BATCH_SIZE) * SKY_ANCHOR_MODEL_BATCH_SIZE;
  const batchCount = Math.min(
    SKY_ANCHOR_MODEL_BATCH_SIZE,
    SKY_ANCHOR_PROP_MODELS.length - batchStart,
  );
  const slotIndex = index - batchStart;

  if (batchCount === 1) return BATCH_MODEL_SLOTS[1];
  if (batchCount === 2) return TWO_MODEL_BATCH_SLOTS[slotIndex] ?? TWO_MODEL_BATCH_SLOTS[0];
  return BATCH_MODEL_SLOTS[slotIndex] ?? BATCH_MODEL_SLOTS[1];
}

function createLoader(): { loader: GLTFLoader; dispose: () => void } {
  const draco = new DRACOLoader();
  const loader = new GLTFLoader();

  draco.setDecoderPath('/external/draco/');
  draco.setWorkerLimit(1);
  loader.setDRACOLoader(draco);

  return {
    loader,
    dispose: () => draco.dispose(),
  };
}

function brightenModelMaterials(root: Group): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    child.frustumCulled = false;
    child.renderOrder = 999;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const converted = materials.map((material) => {
      const source = material as typeof material & {
        color?: Color;
        map?: MeshBasicMaterial['map'];
      };
      const map = source.map ?? null;
      const color = map
        ? new Color('#ffffff')
        : (source.color?.clone().multiplyScalar(1.25) ?? new Color('#ffffff'));

      return new MeshBasicMaterial({
        name: material.name,
        color,
        map,
        side: DoubleSide,
        transparent: false,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
    });

    child.material = Array.isArray(child.material) ? converted : converted[0];
  });
}

function fitModelToBounds(
  root: Group,
  descriptor: SkyAnchorPropModel,
  index: number,
): ModelItem {
  const wrapper = new Group();
  const pivot = new Group();
  const slot = getBatchSlot(index).clone();
  const box = new Box3().setFromObject(root);
  const size = new Vector3();
  const center = new Vector3();

  box.getSize(size);
  box.getCenter(center);
  pivot.position.set(-center.x, -center.y, -center.z);
  pivot.add(root);

  const maxAxis = Math.max(size.x, size.y, size.z, 0.001);
  wrapper.name = `bifan-animated-model-${index}`;
  wrapper.position.copy(slot);
  wrapper.rotation.set(0, 0, 0);
  wrapper.scale.setScalar(descriptor.size / maxAxis);
  wrapper.visible = false;
  wrapper.add(pivot);

  brightenModelMaterials(root);

  return {
    wrapper,
    pivot,
    importedScene: root,
    actions: [],
    slot,
    delay: descriptor.delay ?? 0,
    started: false,
  };
}

function fitModelToAnimationBounds(
  item: ModelItem,
  clip: ThreeAnimationClip,
  descriptor: SkyAnchorPropModel,
): void {
  const bounds = new Box3();
  const sampleBox = new Box3();
  const fitSize = new Vector3();
  const sampleCenter = new Vector3();
  const sampleSize = new Vector3();
  const anchorCenter = new Vector3();
  const sampleMixer = new AnimationMixer(item.importedScene);
  const sampleAction = sampleMixer.clipAction(clip);
  const sampleCount = Math.max(12, Math.ceil(clip.duration * 10));
  let anchorAxis = 0;

  item.wrapper.scale.setScalar(1);
  sampleAction.reset();
  sampleAction.play();

  for (let index = 0; index <= sampleCount; index += 1) {
    sampleMixer.setTime((clip.duration * index) / sampleCount);
    item.wrapper.updateMatrixWorld(true);
    sampleBox.setFromObject(item.wrapper);

    if (!sampleBox.isEmpty()) {
      bounds.union(sampleBox);
      sampleBox.getSize(sampleSize);
      const sampleAxis = Math.max(sampleSize.x, sampleSize.y, sampleSize.z);
      if (sampleAxis > anchorAxis) {
        sampleBox.getCenter(sampleCenter);
        anchorCenter.copy(sampleCenter).sub(item.wrapper.position);
        anchorAxis = sampleAxis;
      }
    }
  }

  sampleMixer.setTime(0);
  sampleAction.stop();
  sampleMixer.uncacheRoot(item.importedScene);
  item.wrapper.updateMatrixWorld(true);

  if (bounds.isEmpty()) return;

  bounds.getSize(fitSize);
  item.pivot.position.sub(anchorCenter);
  const scaleAxis = anchorAxis > 0
    ? anchorAxis
    : Math.max(fitSize.x, fitSize.y, fitSize.z, 0.001);
  item.wrapper.scale.setScalar(descriptor.size / scaleAxis);
  item.wrapper.updateMatrixWorld(true);
}

function resetItem(item: ModelItem): void {
  item.started = false;
  item.wrapper.visible = false;
  item.wrapper.position.copy(item.slot);
  item.actions.forEach((action) => {
    action.stop();
    action.reset();
    action.enabled = true;
    action.paused = true;
  });
}

export class SkyAnchorModelPlayer {
  readonly root = new Group();

  private mixers: AnimationMixer[] = [];
  private mixerRoots: Group[] = [];
  private items: ModelItem[] = [];
  private revealStartedAt: number | null = null;
  private playAnimations = false;
  private loaded = false;
  private activeBatch = -1;

  constructor() {
    this.root.name = 'bifan-camera-locked-anchor';
    this.root.position.set(0, 0, -2.2);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = false;
  }

  async load(onProgress?: (progress: SkyAnchorModelProgress) => void): Promise<void> {
    if (this.loaded) return;

    const { loader, dispose } = createLoader();
    let loaded = 0;
    let failed = 0;
    const total = SKY_ANCHOR_PROP_MODELS.length;

    onProgress?.({ loaded, failed, total });

    try {
      for (let index = 0; index < SKY_ANCHOR_PROP_MODELS.length; index += 1) {
        const descriptor = SKY_ANCHOR_PROP_MODELS[index];
        try {
          const gltf = await loader.loadAsync(cachedUrl(descriptor.url));
          const item = fitModelToBounds(gltf.scene, descriptor, index);
          this.registerAnimations(item, gltf, descriptor);
          this.items.push(item);
          this.root.add(item.wrapper);
          loaded += 1;
        } catch (err) {
          failed += 1;
          console.warn('[SkyAnchorModelPlayer] model load failed', descriptor.url, err);
        }
        onProgress?.({ loaded, failed, total });
      }
    } finally {
      dispose();
    }

    if (!this.items.length) {
      throw new Error('sky-anchor model load failed');
    }

    this.loaded = true;
  }

  attachToScene(scene: Scene): void {
    scene.add(this.root);
  }

  reveal(playAnimations = false): void {
    this.playAnimations = playAnimations;
    this.items.forEach(resetItem);
    this.revealStartedAt = null;
    this.activeBatch = -1;
    this.root.visible = true;
    if (!playAnimations) {
      this.items.forEach((item) => {
        item.started = true;
        item.wrapper.visible = true;
      });
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    if (!this.root.visible || !this.playAnimations) return;

    if (this.revealStartedAt === null) {
      this.revealStartedAt = elapsedSeconds;
    }

    const revealElapsed = elapsedSeconds - this.revealStartedAt;
    const batchDuration = SKY_ANCHOR_MODEL_BATCH_HOLD_MS / 1000;
    const totalBatches = Math.max(1, Math.ceil(this.items.length / SKY_ANCHOR_MODEL_BATCH_SIZE));
    const activeBatch = Math.min(
      Math.floor(revealElapsed / batchDuration),
      totalBatches - 1,
    );
    const batchElapsed = revealElapsed - activeBatch * batchDuration;
    this.activeBatch = activeBatch;

    this.items.forEach((item, index) => {
      const itemBatch = Math.floor(index / SKY_ANCHOR_MODEL_BATCH_SIZE);
      if (itemBatch !== activeBatch) {
        if (item.started || item.wrapper.visible) resetItem(item);
        return;
      }

      if (item.started || batchElapsed < item.delay) return;
      item.started = true;
      item.wrapper.visible = true;
      item.actions.forEach((action) => {
        action.reset();
        action.enabled = true;
        action.paused = false;
        action.play();
      });
    });
    this.mixers.forEach((mixer) => mixer.update(deltaSeconds));
    this.constrainVisibleItemsToSlots();
  }

  getDebugState(): SkyAnchorModelDebugState {
    return {
      activeBatch: this.activeBatch,
      totalBatches: Math.ceil(this.items.length / SKY_ANCHOR_MODEL_BATCH_SIZE),
      visibleCount: this.items.filter((item) => item.wrapper.visible).length,
      loadedCount: this.items.length,
    };
  }

  getVisibleWorldBounds(): Box3 {
    const bounds = new Box3();
    const itemBounds = new Box3();

    this.items.forEach((item) => {
      if (!item.wrapper.visible) return;
      itemBounds.setFromObject(item.wrapper);
      if (!itemBounds.isEmpty()) bounds.union(itemBounds);
    });

    return bounds;
  }

  dispose(): void {
    this.mixers.forEach((mixer, index) => {
      const root = this.mixerRoots[index];
      if (root) mixer.uncacheRoot(root);
    });
    this.root.traverse((child) => {
      if (!(child instanceof Mesh)) return;
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material instanceof MeshBasicMaterial) material.map?.dispose();
        material.dispose();
      });
    });
    this.root.clear();
    this.mixers = [];
    this.mixerRoots = [];
    this.items = [];
    this.loaded = false;
    this.activeBatch = -1;
  }

  private registerAnimations(item: ModelItem, gltf: GLTF, descriptor: SkyAnchorPropModel): void {
    const sourceClip = gltf.animations.find((candidate) => candidate.tracks.length > 0);
    if (!sourceClip) return;

    fitModelToAnimationBounds(item, sourceClip, descriptor);

    const mixer = new AnimationMixer(item.importedScene);
    const action = mixer.clipAction(sourceClip);
    action.setLoop(LoopOnce, 1);
    action.enabled = true;
    action.paused = true;
    action.clampWhenFinished = true;
    action.timeScale = Math.max(
      1,
      sourceClip.duration / Math.max(SKY_ANCHOR_MODEL_BATCH_HOLD_MS / 1000 - item.delay - 0.25, 0.5),
    );
    item.actions.push(action);
    this.mixers.push(mixer);
    this.mixerRoots.push(item.importedScene);
  }

  private constrainVisibleItemsToSlots(): void {
    const bounds = new Box3();
    const center = new Vector3();

    this.root.updateMatrixWorld(true);
    this.items.forEach((item) => {
      if (!item.wrapper.visible) return;

      bounds.setFromObject(item.wrapper);
      if (bounds.isEmpty()) return;

      bounds.getCenter(center);
      this.root.worldToLocal(center);

      const driftX = center.x - item.slot.x;
      if (Math.abs(driftX) > MAX_SLOT_DRIFT_X) {
        item.wrapper.position.x -= driftX - Math.sign(driftX) * MAX_SLOT_DRIFT_X;
      }

      const driftY = center.y - item.slot.y;
      if (Math.abs(driftY) > MAX_SLOT_DRIFT_Y) {
        item.wrapper.position.y -= driftY - Math.sign(driftY) * MAX_SLOT_DRIFT_Y;
      }
    });
  }
}
