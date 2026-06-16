import {
  AnimationMixer,
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  LoopOnce,
  Matrix4,
  Vector3,
  type AnimationAction,
  type Scene,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SKY_ANCHOR_PROP_MODELS, type SkyAnchorPropModel } from '../config/arConfig';
import { cachedUrl } from '../utils/assetPreloader';

interface ModelItem {
  wrapper: Group;
  pivot: Group;
  importedScene: Group;
  actions: AnimationAction[];
  delay: number;
  started: boolean;
}

export interface SkyAnchorModelProgress {
  loaded: number;
  failed: number;
  total: number;
}

function getVisibleMeshBounds(root: Group): Box3 {
  root.updateMatrixWorld(true);
  const bounds = new Box3();
  const meshBox = new Box3();
  const worldBox = new Box3();
  const matrix = new Matrix4();

  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) return;

    meshBox.copy(child.geometry.boundingBox);
    matrix.copy(child.matrixWorld);
    worldBox.copy(meshBox).applyMatrix4(matrix);
    if (!worldBox.isEmpty()) bounds.union(worldBox);
  });

  return bounds;
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
    child.renderOrder = 20;
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
        depthTest: true,
        depthWrite: true,
        toneMapped: false,
      });
    });

    child.material = Array.isArray(child.material) ? converted : converted[0];
  });
}

function fitModelToBounds(root: Group, descriptor: SkyAnchorPropModel, index: number): ModelItem {
  const wrapper = new Group();
  const pivot = new Group();
  const box = getVisibleMeshBounds(root);
  const size = new Vector3();
  const center = new Vector3();

  box.getSize(size);
  box.getCenter(center);
  pivot.position.set(-center.x, -center.y, -center.z);
  pivot.add(root);

  const maxAxis = Math.max(size.x, size.y, size.z, 0.001);
  wrapper.name = `sky-anchor-test-model-${index}`;
  wrapper.position.set(descriptor.x, descriptor.y, 0);
  wrapper.scale.setScalar(descriptor.size / maxAxis);
  wrapper.visible = false;
  wrapper.add(pivot);

  brightenModelMaterials(root);

  return {
    wrapper,
    pivot,
    importedScene: root,
    actions: [],
    delay: descriptor.delay,
    started: false,
  };
}

function resetItem(item: ModelItem): void {
  item.started = false;
  item.wrapper.visible = false;
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

  constructor() {
    this.root.name = 'sky-anchor-model-test-root';
    this.root.position.set(0, -0.18, -1.85);
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
          this.registerAnimations(item, gltf);
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
    this.items.forEach((item) => {
      if (item.started || revealElapsed < item.delay) return;
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
  }

  private registerAnimations(item: ModelItem, gltf: GLTF): void {
    const clip = gltf.animations.find((candidate) => candidate.tracks.length > 0);
    if (!clip) return;

    const mixer = new AnimationMixer(item.importedScene);
    const action = mixer.clipAction(clip);
    action.setLoop(LoopOnce, 1);
    action.enabled = true;
    action.paused = true;
    action.clampWhenFinished = true;
    item.actions.push(action);
    this.mixers.push(mixer);
    this.mixerRoots.push(item.importedScene);
  }
}
