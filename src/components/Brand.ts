/**
 * 브랜드 로고 헬퍼.
 * 실제 로고 이미지(/assets/images/*)가 제공되기 전까지 텍스트 플레이스홀더 사용.
 * 이미지 확정 시 createElement('img')로 교체하세요. (TODO: 로고 에셋)
 */

/** 중앙 BIFAN 메인 로고. */
export function createBifanLogo(): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'bifan-logo';
  wrap.innerHTML = `
    <span class="bifan-logo__mark">BIFAN</span>
    <span class="bifan-logo__sub">30th · 부천국제판타스틱영화제</span>
  `;
  return wrap;
}

/** 하단 3사 로고 스트립: Culture Connection / BIFAN / Studio Realive. */
export function createLogoStrip(): HTMLDivElement {
  const strip = document.createElement('div');
  strip.className = 'logo-strip';
  for (const name of ['Culture Connection', 'BIFAN', 'Studio Realive']) {
    const item = document.createElement('span');
    item.className = 'logo-strip__item';
    item.textContent = name;
    strip.appendChild(item);
  }
  return strip;
}
