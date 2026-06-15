/**
 * 상단 바: ‹ 뒤로 + 타이틀 + (선택) ? 도움말 아이콘.
 */
export interface TopBarOptions {
  title: string;
  onBack?: () => void;
  onHelp?: () => void;
}

export function createTopBar(opts: TopBarOptions): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'topbar';

  const back = document.createElement('button');
  back.className = 'topbar__back';
  back.setAttribute('aria-label', '뒤로');
  back.textContent = '‹';
  if (opts.onBack) back.addEventListener('click', opts.onBack);
  bar.appendChild(back);

  const title = document.createElement('span');
  title.className = 'topbar__title';
  title.textContent = opts.title;
  bar.appendChild(title);

  if (opts.onHelp) {
    const help = document.createElement('button');
    help.className = 'topbar__help';
    help.setAttribute('aria-label', '체험 방법 안내');
    help.textContent = '?';
    help.addEventListener('click', opts.onHelp);
    bar.appendChild(help);
  } else {
    // 타이틀 가운데 정렬 유지를 위한 우측 스페이서.
    const spacer = document.createElement('span');
    spacer.className = 'topbar__spacer';
    bar.appendChild(spacer);
  }

  return bar;
}
