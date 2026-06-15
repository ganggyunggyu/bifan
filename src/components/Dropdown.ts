/**
 * 드롭다운: 기본 select 스타일 오버라이드 + 우측 chevron.
 */
export interface DropdownOptions {
  label: string;
  items: string[];
  value?: string;
  onChange: (value: string) => void;
}

export class Dropdown {
  readonly el: HTMLLabelElement;
  private select: HTMLSelectElement;

  constructor(opts: DropdownOptions) {
    this.el = document.createElement('label');
    this.el.className = 'dropdown';

    const caption = document.createElement('span');
    caption.className = 'dropdown__label';
    caption.textContent = opts.label;
    this.el.appendChild(caption);

    const field = document.createElement('div');
    field.className = 'dropdown__field';

    this.select = document.createElement('select');
    this.select.className = 'dropdown__select';
    for (const item of opts.items) {
      const o = document.createElement('option');
      o.value = item;
      o.textContent = item;
      this.select.appendChild(o);
    }
    if (opts.value) this.select.value = opts.value;
    this.select.addEventListener('change', () => opts.onChange(this.select.value));

    const chevron = document.createElement('span');
    chevron.className = 'dropdown__chevron';
    chevron.setAttribute('aria-hidden', 'true');

    field.appendChild(this.select);
    field.appendChild(chevron);
    this.el.appendChild(field);
  }

  get value(): string {
    return this.select.value;
  }
}
