/**
 * 공통 모달: 반투명 오버레이 + 흰 카드 + 버튼 2개.
 */
export interface ModalButton {
  label: string;
  /** 'primary' = BIFAN 블루, 'dark' = 보조 다크 버튼. */
  variant?: 'primary' | 'dark';
  onClick: () => void;
}

export interface ModalOptions {
  body: string;
  /** 본문 아래 강조 라인(예: 필요 데이터 42MB). 선택. */
  detail?: string;
  buttons: ModalButton[];
}

export class Modal {
  private overlay: HTMLDivElement;

  constructor(opts: ModalOptions) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'modal-overlay';

    const card = document.createElement('div');
    card.className = 'modal-card';

    const body = document.createElement('p');
    body.className = 'modal-body';
    body.textContent = opts.body;
    card.appendChild(body);

    if (opts.detail) {
      const detail = document.createElement('p');
      detail.className = 'modal-detail';
      detail.textContent = opts.detail;
      card.appendChild(detail);
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    for (const btn of opts.buttons) {
      const el = document.createElement('button');
      el.className = `btn btn-${btn.variant ?? 'primary'}`;
      el.textContent = btn.label;
      el.addEventListener('click', btn.onClick);
      actions.appendChild(el);
    }
    card.appendChild(actions);

    this.overlay.appendChild(card);
  }

  mount(parent: HTMLElement): void {
    parent.appendChild(this.overlay);
    // 다음 프레임에 visible 클래스 추가 → fade/scale 인 애니메이션.
    requestAnimationFrame(() => this.overlay.classList.add('is-visible'));
  }

  close(): void {
    this.overlay.remove();
  }
}
