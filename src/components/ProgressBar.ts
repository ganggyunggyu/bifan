/**
 * 전체 너비 프로그레스 바 (BIFAN 블루).
 * determinate(진행률 0~1) 및 indeterminate(인디케이터) 모드 지원.
 */
export class ProgressBar {
  readonly el: HTMLDivElement;
  private fill: HTMLDivElement;

  constructor(indeterminate = false) {
    this.el = document.createElement('div');
    this.el.className = 'progress-track';

    this.fill = document.createElement('div');
    this.fill.className = 'progress-fill';
    if (indeterminate) {
      this.el.classList.add('is-indeterminate');
    }
    this.el.appendChild(this.fill);
  }

  /** ratio: 0~1 */
  setProgress(ratio: number): void {
    const pct = Math.max(0, Math.min(1, ratio)) * 100;
    this.fill.style.width = `${pct}%`;
  }
}
