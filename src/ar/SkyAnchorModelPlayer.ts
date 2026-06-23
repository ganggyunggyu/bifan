import {
  AnimationClip,
  AnimationMixer,
  Box3,
  Color,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  LoopOnce,
  PlaneGeometry,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector3,
  type AnimationAction,
  type AnimationClip as ThreeAnimationClip,
  type Scene,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS,
  SKY_ANCHOR_MODEL_FADE_OUT_MS,
  SKY_ANCHOR_MODEL_VISIBLE_MS,
  SKY_ANCHOR_PROP_MODELS,
  type SkyAnchorPropModel,
} from '../config/arConfig';
import { cachedUrl } from '../utils/assetPreloader';
import {
  buildSkyAnchorTimeline,
  getActiveTimelineBatch,
  type SkyAnchorTimeline,
} from './skyAnchorTimeline';

interface ModelItem {
  label: string;
  kind: NonNullable<SkyAnchorPropModel['kind']>;
  wrapper: Group;
  pivot: Group;
  importedScene: Group;
  actions: AnimationAction[];
  mixer?: AnimationMixer;
  slot: Vector3;
  sequenceIndex: number;
  persistent: boolean;
  delay: number;
  duration: number;
  opacity: number;
  started: boolean;
  sprite?: SpriteAnimation;
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
  persistentVisibleCount: number;
  originLockedVisibleCount: number;
  loadedCount: number;
  anchorLocked: boolean;
  anchorX: number;
  anchorY: number;
  anchorZ: number;
  anchorMode: string;
  pngSequenceCount: number;
  pngSequenceVisibleCount: number;
  pngSequenceFrame: number;
  pngSequenceFrameCount: number;
  pngSequenceLabel: string;
}

export interface SkyAnchorVisibleItemBounds {
  bounds: Box3;
  label: string;
  opacity: number;
  sequenceIndex: number;
}

interface SpriteAnimation {
  texture: Texture;
  columns: number;
  rows: number;
  frameCount: number;
  fps: number;
  lastFrame: number;
}

interface PlaybackAnimationClip {
  clip: ThreeAnimationClip;
}

const ZERO_MODEL_SLOT = new Vector3(0, 0, 0);
const MODEL_LOAD_CONCURRENCY = 2;
const MODEL_PRESENTATION_SCALE = 1.22;
const CAMERA_ANCHOR_Y = 0.06;
const CAMERA_ANCHOR_Z = -3.0;
const WORLD_ANCHOR_Y = 0.02;
const MODEL_TINT_COLORS = ['#f7fbff', '#7fe5ff', '#ffd95c', '#ff73cf'];
const ENTRY_STAGGER_SECONDS = SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS / 1000;
const VISIBLE_SECONDS = SKY_ANCHOR_MODEL_VISIBLE_MS / 1000;
const FADE_OUT_SECONDS = SKY_ANCHOR_MODEL_FADE_OUT_MS / 1000;

function getDescriptorLabel(descriptor: SkyAnchorPropModel): string {
  if (descriptor.label) return descriptor.label;
  return descriptor.url.split('/').pop() ?? descriptor.url;
}

function getTimelineSlot(): Vector3 {
  return ZERO_MODEL_SLOT.clone();
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

function setSpriteFrame(sprite: SpriteAnimation, frameIndex: number): void {
  const frame = ((frameIndex % sprite.frameCount) + sprite.frameCount) % sprite.frameCount;
  if (frame === sprite.lastFrame) return;

  const col = frame % sprite.columns;
  const row = Math.floor(frame / sprite.columns);
  sprite.texture.offset.set(col / sprite.columns, 1 - (row + 1) / sprite.rows);
  sprite.lastFrame = frame;
}

function brightenModelMaterials(root: Group, modelIndex: number): void {
  const tint = new Color(MODEL_TINT_COLORS[modelIndex % MODEL_TINT_COLORS.length]);

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    child.frustumCulled = false;
    child.renderOrder = 999;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const visibleMaterials = materials.map((material) => {
      const source = material as typeof material & {
        alphaMap?: Texture | null;
        alphaTest?: number;
        color?: Color;
        map?: Texture | null;
        opacity?: number;
        vertexColors?: boolean;
      };
      const map = source.map ?? null;
      const alphaMap = source.alphaMap ?? null;
      const sourceColor = source.color?.clone() ?? (map ? new Color('#ffffff') : tint.clone());
      const sourceOpacity = Number.isFinite(source.opacity) ? source.opacity : 1;
      const sourceAlphaTest = Number.isFinite(source.alphaTest) ? source.alphaTest : 0.01;

      if (map) {
        map.colorSpace = SRGBColorSpace;
        map.flipY = false;
        map.minFilter = LinearFilter;
        map.magFilter = LinearFilter;
        map.needsUpdate = true;
      }
      if (alphaMap) {
        alphaMap.flipY = false;
        alphaMap.minFilter = LinearFilter;
        alphaMap.magFilter = LinearFilter;
        alphaMap.needsUpdate = true;
      }

      return new MeshBasicMaterial({
        name: material.name,
        color: sourceColor,
        map,
        alphaMap,
        alphaTest: sourceAlphaTest,
        side: DoubleSide,
        transparent: true,
        opacity: sourceOpacity,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        vertexColors: source.vertexColors ?? false,
      });
    });

    child.material = Array.isArray(child.material) ? visibleMaterials : visibleMaterials[0];
  });
}

function createPlaybackAnimationClip(sourceClip: ThreeAnimationClip): PlaybackAnimationClip | null {
  const tracks = sourceClip.tracks.reduce<ThreeAnimationClip['tracks']>((nextTracks, track) => {
    const name = track.name;
    if (
      name.endsWith('.position') ||
      name.endsWith('.visible') ||
      name.includes('.material.opacity') ||
      name.includes('.material[')
    ) {
      return nextTracks;
    }

    const clonedTrack = track.clone();
    nextTracks.push(clonedTrack);
    return nextTracks;
  }, []);

  if (!tracks.length) return null;
  return {
    clip: new AnimationClip(`${sourceClip.name || 'clip'}-playback`, sourceClip.duration, tracks),
  };
}

function fitModelToBounds(
  root: Group,
  descriptor: SkyAnchorPropModel,
  index: number,
  sequenceIndex: number,
  delay: number,
  duration: number,
): ModelItem {
  const wrapper = new Group();
  const pivot = new Group();
  const slot = getTimelineSlot();
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
  wrapper.scale.setScalar((descriptor.size * MODEL_PRESENTATION_SCALE) / maxAxis);
  wrapper.visible = false;
  wrapper.add(pivot);

  brightenModelMaterials(root, index);

  return {
    label: getDescriptorLabel(descriptor),
    kind: descriptor.kind ?? 'gltf',
    wrapper,
    pivot,
    importedScene: root,
    actions: [],
    slot,
    sequenceIndex,
    persistent: !!descriptor.persistent,
    delay,
    duration,
    opacity: 1,
    started: false,
  };
}

function createSpriteItem(
  texture: Texture,
  descriptor: SkyAnchorPropModel,
  index: number,
  sequenceIndex: number,
  delay: number,
  duration: number,
): ModelItem {
  if (!descriptor.sprite) {
    throw new Error('sprite descriptor missing');
  }

  texture.colorSpace = SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.repeat.set(1 / descriptor.sprite.columns, 1 / descriptor.sprite.rows);
  texture.needsUpdate = true;
  const wrapper = new Group();
  const pivot = new Group();
  const slot = getTimelineSlot();
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 1,
    alphaTest: 0.01,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    side: DoubleSide,
  });
  const geometry = new PlaneGeometry(descriptor.sprite.aspect, 1);
  const mesh = new Mesh(geometry, material);
  const sprite: SpriteAnimation = {
    texture,
    columns: descriptor.sprite.columns,
    rows: descriptor.sprite.rows,
    frameCount: descriptor.sprite.frameCount,
    fps: descriptor.sprite.fps,
    lastFrame: -1,
  };

  mesh.frustumCulled = false;
  mesh.renderOrder = 1000;
  pivot.add(mesh);
  wrapper.name = `bifan-animated-sprite-${index}`;
  wrapper.position.copy(slot);
  wrapper.scale.setScalar(descriptor.size * MODEL_PRESENTATION_SCALE);
  wrapper.visible = false;
  wrapper.add(pivot);
  setSpriteFrame(sprite, 0);

  return {
    label: getDescriptorLabel(descriptor),
    kind: descriptor.kind === 'png-sequence' ? 'png-sequence' : 'sprite',
    wrapper,
    pivot,
    importedScene: pivot,
    actions: [],
    slot: slot.clone(),
    sequenceIndex,
    persistent: !!descriptor.persistent,
    delay,
    duration,
    opacity: 1,
    started: false,
    sprite,
  };
}

function fitModelToAnimationBounds(
  item: ModelItem,
  clip: ThreeAnimationClip,
  descriptor: SkyAnchorPropModel,
): void {
  const bounds = new Box3();
  const sampleBox = new Box3();
  const fitCenter = new Vector3();
  const fitSize = new Vector3();
  const sampleMixer = new AnimationMixer(item.importedScene);
  const sampleAction = sampleMixer.clipAction(clip);
  const sampleCount = Math.max(12, Math.ceil(clip.duration * 10));

  item.wrapper.scale.setScalar(1);
  sampleAction.reset();
  sampleAction.play();

  for (let index = 0; index <= sampleCount; index += 1) {
    sampleMixer.setTime((clip.duration * index) / sampleCount);
    item.wrapper.updateMatrixWorld(true);
    sampleBox.setFromObject(item.wrapper);

    if (!sampleBox.isEmpty()) {
      bounds.union(sampleBox);
    }
  }

  sampleMixer.setTime(0);
  sampleAction.stop();
  sampleMixer.uncacheRoot(item.importedScene);
  item.wrapper.updateMatrixWorld(true);

  if (bounds.isEmpty()) return;

  bounds.getCenter(fitCenter);
  bounds.getSize(fitSize);
  item.pivot.position.sub(fitCenter.sub(item.wrapper.position));
  item.wrapper.scale.setScalar(
    (descriptor.size * MODEL_PRESENTATION_SCALE) / Math.max(fitSize.x, fitSize.y, fitSize.z, 0.001),
  );
  item.wrapper.updateMatrixWorld(true);
}

function resetItem(item: ModelItem): void {
  item.started = false;
  item.wrapper.visible = false;
  item.wrapper.position.copy(item.slot);
  setItemOpacity(item, 1);
  item.actions.forEach((action) => {
    action.stop();
    action.reset();
    action.enabled = true;
    action.paused = true;
  });
  if (item.sprite) {
    item.sprite.lastFrame = -1;
    setSpriteFrame(item.sprite, 0);
  }
}

function startItem(item: ModelItem): void {
  item.started = true;
  item.wrapper.visible = true;
  setItemOpacity(item, 1);
  item.actions.forEach((action) => {
    action.reset();
    action.enabled = true;
    action.paused = false;
    action.play();
  });
}

function getItemOpacity(localElapsed: number, duration: number): number {
  const fadeDuration = Math.max(FADE_OUT_SECONDS, 0.001);
  const fadeStart = Math.max(0, duration - fadeDuration);
  if (localElapsed <= fadeStart) return 1;
  return Math.max(0, 1 - (localElapsed - fadeStart) / fadeDuration);
}

function setItemOpacity(item: ModelItem, opacity: number): void {
  if (item.kind === 'png-sequence') return;
  if (Math.abs(item.opacity - opacity) < 0.001) return;

  item.opacity = opacity;
  item.wrapper.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!(material instanceof MeshBasicMaterial)) return;
      material.opacity = opacity;
    });
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
  private anchorLocked = false;
  private anchorMode = 'unlocked';
  private timeline: SkyAnchorTimeline | null = null;

  constructor() {
    this.root.name = 'bifan-world-locked-anchor';
    this.root.position.set(0, CAMERA_ANCHOR_Y, CAMERA_ANCHOR_Z);
    this.root.rotation.set(0, 0, 0);
    this.root.visible = false;
  }

  async load(onProgress?: (progress: SkyAnchorModelProgress) => void): Promise<void> {
    if (this.loaded) return;

    let loaded = 0;
    let failed = 0;
    const total = SKY_ANCHOR_PROP_MODELS.length;
    const loadedItems: Array<ModelItem | null> = Array.from({ length: total }, () => null);
    let nextLoadIndex = 0;
    const timeline = buildSkyAnchorTimeline(SKY_ANCHOR_PROP_MODELS, {
      entryStaggerSeconds: ENTRY_STAGGER_SECONDS,
      visibleSeconds: VISIBLE_SECONDS,
    });
    onProgress?.({ loaded, failed, total });

    const loadNext = async (): Promise<void> => {
      for (;;) {
        const index = nextLoadIndex;
        nextLoadIndex += 1;
        if (index >= SKY_ANCHOR_PROP_MODELS.length) return;

        const descriptor = SKY_ANCHOR_PROP_MODELS[index];
        const itemTimeline = timeline.items[index];
        const itemSequenceIndex = itemTimeline.sequenceIndex;
        const itemDelay = itemTimeline.delay;
        const itemDuration = itemTimeline.duration;
        try {
          let item: ModelItem;
          if (descriptor.kind === 'sprite' || descriptor.kind === 'png-sequence') {
            const texture = await new TextureLoader().loadAsync(cachedUrl(descriptor.url));
            item = createSpriteItem(texture, descriptor, index, itemSequenceIndex, itemDelay, itemDuration);
          } else {
            const { loader, dispose } = createLoader();
            try {
              const gltf = await loader.loadAsync(cachedUrl(descriptor.url));
              item = fitModelToBounds(gltf.scene, descriptor, index, itemSequenceIndex, itemDelay, itemDuration);
              this.registerAnimations(item, gltf, descriptor);
            } finally {
              dispose();
            }
          }
          loadedItems[index] = item;
          loaded += 1;
        } catch (err) {
          failed += 1;
          console.warn('[SkyAnchorModelPlayer] model load failed', descriptor.url, err);
        }
        onProgress?.({ loaded, failed, total });
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(MODEL_LOAD_CONCURRENCY, SKY_ANCHOR_PROP_MODELS.length) },
        () => loadNext(),
      ),
    );

    this.items = loadedItems.filter((item): item is ModelItem => item !== null);
    this.items.forEach((item) => this.root.add(item.wrapper));
    this.timeline = timeline;

    if (!this.items.length) {
      throw new Error('sky-anchor model load failed');
    }

    this.loaded = true;
  }

  attachToScene(scene: Scene): void {
    scene.add(this.root);
  }

  lockToFallbackWorld(): void {
    if (this.anchorLocked) return;

    this.root.position.set(0, CAMERA_ANCHOR_Y, CAMERA_ANCHOR_Z);
    this.root.rotation.set(0, 0, 0);
    this.root.updateMatrixWorld(true);
    this.anchorLocked = true;
    this.anchorMode = 'fallback-fixed';
  }

  lockToHitTestResult(
    hit: {
      position: { x: number; y: number; z: number };
      type?: string;
    },
    camera?: { getWorldPosition: (target: Vector3) => Vector3 },
  ): void {
    if (this.anchorLocked) return;

    this.root.position.set(
      hit.position.x,
      hit.position.y + WORLD_ANCHOR_Y,
      hit.position.z,
    );
    if (camera) {
      const cameraPosition = new Vector3();
      camera.getWorldPosition(cameraPosition);
      const dx = cameraPosition.x - this.root.position.x;
      const dz = cameraPosition.z - this.root.position.z;
      this.root.rotation.set(0, Math.atan2(dx, dz), 0);
    } else {
      this.root.rotation.set(0, 0, 0);
    }
    this.root.updateMatrixWorld(true);
    this.anchorLocked = true;
    this.anchorMode = `hittest:${hit.type ?? 'UNKNOWN'}`;
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
    } else {
      this.items.forEach((item) => {
        if (item.persistent) startItem(item);
      });
    }
  }

  update(deltaSeconds: number, elapsedSeconds: number): void {
    if (!this.root.visible || !this.playAnimations) return;

    if (this.revealStartedAt === null) {
      this.revealStartedAt = elapsedSeconds;
    }

    const revealElapsed = elapsedSeconds - this.revealStartedAt;
    this.activeBatch = this.timeline
      ? getActiveTimelineBatch(this.timeline, revealElapsed, ENTRY_STAGGER_SECONDS)
      : -1;

    this.items.forEach((item) => {
      const localElapsed = revealElapsed - item.delay;
      if (item.persistent) {
        if (localElapsed < 0) {
          if (item.started || item.wrapper.visible) resetItem(item);
          return;
        }
        if (!item.started) startItem(item);
        setItemOpacity(item, 1);
        return;
      }

      if (localElapsed < 0 || localElapsed >= item.duration) {
        if (item.started || item.wrapper.visible) resetItem(item);
        return;
      }

      if (!item.started) startItem(item);
      setItemOpacity(item, getItemOpacity(localElapsed, item.duration));
    });
    this.items.forEach((item) => {
      if (!item.mixer || !item.wrapper.visible || !item.started) return;
      item.mixer.update(deltaSeconds);
    });
    this.updateSpriteAnimations(revealElapsed);
  }

  getDebugState(): SkyAnchorModelDebugState {
    const sequenceItemCount = this.items.filter((item) => !item.persistent && item.sequenceIndex >= 0).length;
    const visibleItems = this.items.filter((item) => item.wrapper.visible);
    const pngSequenceItems = this.items.filter((item) => item.kind === 'png-sequence');
    const visiblePngSequenceItems = visibleItems.filter((item) => item.kind === 'png-sequence');
    const debugPngSequence = visiblePngSequenceItems[0] ?? pngSequenceItems[0];
    return {
      activeBatch: this.activeBatch,
      totalBatches: sequenceItemCount,
      visibleCount: visibleItems.length,
      persistentVisibleCount: visibleItems.filter((item) => item.persistent).length,
      originLockedVisibleCount: visibleItems.filter((item) =>
        item.wrapper.position.lengthSq() < 0.000001
      ).length,
      loadedCount: this.items.length,
      anchorLocked: this.anchorLocked,
      anchorX: this.root.position.x,
      anchorY: this.root.position.y,
      anchorZ: this.root.position.z,
      anchorMode: this.anchorMode,
      pngSequenceCount: pngSequenceItems.length,
      pngSequenceVisibleCount: visiblePngSequenceItems.length,
      pngSequenceFrame: debugPngSequence?.sprite?.lastFrame ?? -1,
      pngSequenceFrameCount: debugPngSequence?.sprite?.frameCount ?? 0,
      pngSequenceLabel: debugPngSequence?.label ?? '',
    };
  }

  getVisibleWorldBounds(): Box3 {
    const bounds = new Box3();
    const itemBounds = new Box3();

    this.items.forEach((item) => {
      if (!item.wrapper.visible) return;
      itemBounds.setFromObject(item.pivot);
      if (!itemBounds.isEmpty()) bounds.union(itemBounds);
    });

    return bounds;
  }

  getVisibleItemBounds(): SkyAnchorVisibleItemBounds[] {
    const bounds = new Box3();

    return this.items
      .filter((item) => item.wrapper.visible)
      .map((item) => {
        bounds.setFromObject(item.pivot);
        return {
          bounds: bounds.clone(),
          label: item.label,
          opacity: item.opacity,
          sequenceIndex: item.sequenceIndex,
        };
      });
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
    this.anchorLocked = false;
    this.anchorMode = 'unlocked';
    this.timeline = null;
  }

  private registerAnimations(item: ModelItem, gltf: GLTF, descriptor: SkyAnchorPropModel): void {
    const sourceClip = gltf.animations.find((candidate) => candidate.tracks.length > 0);
    if (!sourceClip) return;
    const playback = createPlaybackAnimationClip(sourceClip);

    if (!playback) return;
    fitModelToAnimationBounds(item, playback.clip, descriptor);

    const mixer = new AnimationMixer(item.importedScene);
    const action = mixer.clipAction(playback.clip);
    action.setLoop(LoopOnce, 1);
    action.enabled = true;
    action.paused = true;
    action.clampWhenFinished = true;
    item.actions.push(action);
    item.mixer = mixer;
    this.mixers.push(mixer);
    this.mixerRoots.push(item.importedScene);
  }

  private updateSpriteAnimations(revealElapsed: number): void {
    this.items.forEach((item) => {
      if (!item.sprite || !item.wrapper.visible || !item.started) return;

      const localElapsed = Math.max(0, revealElapsed - item.delay);
      setSpriteFrame(item.sprite, Math.floor(localElapsed * item.sprite.fps));
    });
  }
}
