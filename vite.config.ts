import { defineConfig } from 'vite';

// 8th Wall과 카메라는 보안 컨텍스트(HTTPS)에서만 동작합니다.
// 모바일 실기기 테스트는 cloudflared 터널(npm run tunnel)로 HTTPS URL을 발급해 사용합니다.
export default defineConfig({
  server: {
    host: true,
    // 터널(*.trycloudflare.com 등) 호스트 헤더 허용. dev 전용.
    allowedHosts: true,
    headers: {
      // Mirrors vercel.json so SharedArrayBuffer-based engines work in dev too.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
