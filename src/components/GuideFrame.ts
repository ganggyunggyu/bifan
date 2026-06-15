/**
 * AR 카메라 가이드 프레임: 4모서리 L자형 선.
 * 미인식=빨강 / 인식=초록 상태를 토글합니다.
 */
export class GuideFrame {
  readonly el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'guide-frame is-searching';
    // 4모서리 코너.
    for (const corner of ['tl', 'tr', 'bl', 'br'] as const) {
      const c = document.createElement('span');
      c.className = `guide-corner guide-${corner}`;
      this.el.appendChild(c);
    }
  }

  setFound(found: boolean): void {
    this.el.classList.toggle('is-found', found);
    this.el.classList.toggle('is-searching', !found);
  }
}
