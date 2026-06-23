import type { Page, PageFactory } from '../pages/Page';

/**
 * Hash 기반 SPA 라우터 (Vercel 정적 배포 대응).
 * 경로 변경 시 현재 페이지를 unmount하고 새 페이지를 mount합니다.
 */
export class Router {
  private routes = new Map<string, PageFactory>();
  private current: Page | null = null;
  private root: HTMLElement;
  private fallback: string;

  constructor(root: HTMLElement, fallback = '/') {
    this.root = root;
    this.fallback = fallback;
    window.addEventListener('hashchange', () => this.render());
  }

  register(path: string, factory: PageFactory): this {
    this.routes.set(path, factory);
    return this;
  }

  /** 프로그램적으로 경로 이동. */
  navigate(path: string): void {
    if (this.currentPath() === path) {
      this.render();
    } else {
      window.location.hash = path;
    }
  }

  start(): void {
    if (!window.location.hash) {
      window.location.hash = this.fallback;
    }
    this.render();
  }

  private currentPath(): string {
    return window.location.hash.replace(/^#/, '') || this.fallback;
  }

  private render(): void {
    const path = this.currentPath();
    const factory = this.routes.get(path) ?? this.routes.get(this.fallback);
    if (!factory) {
      console.warn(`[router] no route for "${path}" and no fallback registered`);
      return;
    }

    this.current?.unmount();
    this.root.replaceChildren();

    const page = factory();
    this.current = page;
    page.mount(this.root);
  }
}

// 라우트 경로 상수 — 오타 방지를 위해 한 곳에서 관리.
export const ROUTES = {
  loading: '/',
  message: '/message',
  arLoading: '/ar-loading',
  arAnimation: '/ar-animation',
  messageIntro: '/message-intro',
  posterIntro: '/poster-intro',
  // Phase 2/3 (라우터 등록은 추후):
  poster: '/poster',
  posterStyle: '/poster/style',
  posterLoading: '/poster/loading',
  posterResult: '/poster/result',
  posterExhibit: '/poster/exhibit',
} as const;

// 모든 페이지가 공유하는 단일 라우터 인스턴스 (main.ts에서 초기화).
export let router: Router;
export function initRouter(root: HTMLElement): Router {
  router = new Router(root, ROUTES.loading);
  return router;
}
