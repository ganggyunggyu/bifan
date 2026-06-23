import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

const enableLocalHttps = process.env.BIFAN_HTTPS === '1';
const rootDir = dirname(fileURLToPath(import.meta.url));
const localCertPath = resolve(rootDir, '.certs/localhost.pem');
const localKeyPath = resolve(rootDir, '.certs/localhost-key.pem');
const hasTrustedLocalCert = existsSync(localCertPath) && existsSync(localKeyPath);
const localApiProxyTarget = process.env.BIFAN_API_PROXY_TARGET ?? 'http://127.0.0.1:5182';

// localhost/127.0.0.1은 보안 컨텍스트로 인정됩니다.
// 모바일 실기기에서 LAN IP로 테스트할 때는 HTTPS 또는 cloudflared 터널(npm run tunnel)을 사용합니다.
export default defineConfig({
  plugins: enableLocalHttps && !hasTrustedLocalCert ? [basicSsl()] : [],
  server: {
    host: true,
    https:
      enableLocalHttps && hasTrustedLocalCert
        ? {
            cert: readFileSync(localCertPath),
            key: readFileSync(localKeyPath),
          }
        : undefined,
    // 터널(*.trycloudflare.com 등) 호스트 헤더 허용. dev 전용.
    allowedHosts: true,
    headers: {
      // Mirrors vercel.json so SharedArrayBuffer-based engines work in dev too.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api': {
        target: localApiProxyTarget,
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
