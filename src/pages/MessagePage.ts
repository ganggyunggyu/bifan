import type { Page } from './Page';
import { router, ROUTES } from '../utils/router';
import {
  ANNIVERSARY_MESSAGES,
  MESSAGE_INTERVAL_MS,
  MESSAGE_OUTRO_MS,
} from '../config/messages';

/**
 * [Screen 3] 30주년 감사 메시지 — 단락별 순차 fade-in.
 */
export class MessagePage implements Page {
  private timers: number[] = [];

  mount(root: HTMLElement): void {
    const screen = document.createElement('div');
    screen.className = 'screen screen--center message-page';

    const stack = document.createElement('div');
    stack.className = 'message-stack';

    const paragraphs = ANNIVERSARY_MESSAGES.map((text) => {
      const p = document.createElement('p');
      p.className = 'message-paragraph';
      // \n 을 줄바꿈으로.
      p.textContent = text;
      stack.appendChild(p);
      return p;
    });

    screen.appendChild(stack);
    root.appendChild(screen);

    // 단락 순차 등장.
    paragraphs.forEach((p, i) => {
      this.timers.push(
        window.setTimeout(() => p.classList.add('is-visible'), i * MESSAGE_INTERVAL_MS),
      );
    });

    // 마지막 단락 등장 후 outro 대기 → 로딩(3초) → 포스터 제작(Module B).
    const total = (paragraphs.length - 1) * MESSAGE_INTERVAL_MS + MESSAGE_OUTRO_MS;
    this.timers.push(
      window.setTimeout(() => router.navigate(ROUTES.posterIntro), total),
    );
  }

  unmount(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}
