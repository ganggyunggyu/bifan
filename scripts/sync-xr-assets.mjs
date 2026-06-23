import { cp, mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, '..');
const xrSourceDir = resolve(projectRoot, 'node_modules/@8thwall/engine-binary/dist');
const xrTargetDir = resolve(projectRoot, 'public/external/xr');
const dracoSourceDir = resolve(projectRoot, 'node_modules/three/examples/jsm/libs/draco/gltf');
const dracoTargetDir = resolve(projectRoot, 'public/external/draco');
const xrCdnResources = [
  {
    url: 'https://cdn.8thwall.com/web/resources/draco-worker-l5sniji5.js',
    fileName: 'draco-worker-l5sniji5.js',
  },
  {
    url: 'https://cdn.8thwall.com/web/resources/draco_wasm_wrapper-l325u8do.js',
    fileName: 'draco_wasm_wrapper-l325u8do.js',
  },
];

const syncXrCdnResource = async ({ url, fileName }) => {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} responded ${response.status} ${response.statusText}`.trim());
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(resolve(xrTargetDir, 'resources'), { recursive: true });
  await writeFile(resolve(xrTargetDir, 'resources', fileName), buffer);
};

try {
  await stat(xrSourceDir);
  await mkdir(xrTargetDir, { recursive: true });
  await cp(xrSourceDir, xrTargetDir, { recursive: true, force: true });
  await Promise.all(xrCdnResources.map(syncXrCdnResource));

  await stat(dracoSourceDir);
  await mkdir(dracoTargetDir, { recursive: true });
  await cp(dracoSourceDir, dracoTargetDir, { recursive: true, force: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`External AR asset sync failed: ${message}`);
  process.exit(1);
}
