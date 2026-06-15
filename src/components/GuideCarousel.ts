/**
 * 안내 이미지 캐러셀 (Module B 체험 방법).
 *
 * 각 슬라이드는 디자인된 풀카드 이미지 1장입니다(타이틀/단계/일러스트/설명/점/화살표가
 * 이미지에 포함). 따라서 별도 텍스트 chrome 없이 이미지를 그대로 보여주고,
 * 스와이프 + 좌우 탭 영역으로 넘기며, 마지막 장의 CTA(지금 제작하러가기) 위치를
 * 누르면 닫힙니다.
 */
export interface GuideCarouselOptions {
  images: string[];
  /** 마지막 슬라이드에서 CTA(또는 화면)를 눌렀을 때 호출. */
  onClose: () => void;
}

export class GuideCarousel {
  private overlay: HTMLDivElement;
  private track: HTMLDivElement;
  private prevBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private ctaBtn: HTMLButtonElement;
  private index = 0;
  private opts: GuideCarouselOptions;

  constructor(opts: GuideCarouselOptions) {
    this.opts = opts;

    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    const frame = document.createElement('div');
    frame.className = 'image-carousel';

    const viewport = document.createElement('div');
    viewport.className = 'image-carousel__viewport';

    this.track = document.createElement('div');
    this.track.className = 'image-carousel__track';

    opts.images.forEach((src) => {
      const slide = document.createElement('div');
      slide.className = 'image-carousel__slide';
      const img = document.createElement('img');
      img.className = 'ic-img';
      img.src = src;
      img.alt = '안내';
      img.draggable = false;
      slide.appendChild(img);
      this.track.appendChild(slide);
    });
    viewport.appendChild(this.track);
    frame.appendChild(viewport);

    // 좌/우 탭 내비게이션(이미지의 화살표 위치에 맞춘 투명 영역).
    this.prevBtn = document.createElement('button');
    this.prevBtn.className = 'ic-nav ic-nav--prev';
    this.prevBtn.setAttribute('aria-label', '이전');
    this.prevBtn.addEventListener('click', () => this.go(this.index - 1));

    this.nextBtn = document.createElement('button');
    this.nextBtn.className = 'ic-nav ic-nav--next';
    this.nextBtn.setAttribute('aria-label', '다음');
    this.nextBtn.addEventListener('click', () => this.go(this.index + 1));

    // 마지막 장의 CTA(지금 제작하러가기) 위치 → 닫기.
    this.ctaBtn = document.createElement('button');
    this.ctaBtn.className = 'ic-cta-zone';
    this.ctaBtn.setAttribute('aria-label', '지금 제작하러가기');
    this.ctaBtn.addEventListener('click', () => this.close());

    frame.append(this.prevBtn, this.nextBtn, this.ctaBtn);
    this.overlay.appendChild(frame);

    this.setupSwipe(viewport);
    this.update();
  }

  private setupSwipe(viewport: HTMLElement): void {
    let startX = 0;
    let dragging = false;
    viewport.addEventListener('pointerdown', (e) => {
      dragging = true;
      startX = e.clientX;
    });
    const end = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 36) this.go(this.index + (dx < 0 ? 1 : -1));
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', () => (dragging = false));
  }

  private go(i: number): void {
    this.index = Math.max(0, Math.min(this.opts.images.length - 1, i));
    this.update();
  }

  private update(): void {
    this.track.style.transform = `translateX(-${this.index * 100}%)`;
    const isLast = this.index === this.opts.images.length - 1;
    const isFirst = this.index === 0;
    // 끝에서는 해당 방향 내비 비활성, 마지막 장에서만 CTA 활성.
    this.prevBtn.style.display = isFirst ? 'none' : '';
    this.nextBtn.style.display = isLast ? 'none' : '';
    this.ctaBtn.style.display = isLast ? '' : 'none';
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.overlay);
    requestAnimationFrame(() => this.overlay.classList.add('is-visible'));
  }

  close(): void {
    this.overlay.remove();
    this.opts.onClose();
  }
}
