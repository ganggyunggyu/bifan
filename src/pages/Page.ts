/**
 * 모든 화면(Page)의 공통 인터페이스.
 * Router가 mount/unmount 생명주기를 관리합니다.
 */
export interface Page {
  /**
   * 화면을 root에 렌더링하고 동작을 시작합니다.
   * 일부 페이지는 카메라/AR 초기화로 async이며, 이 경우 await 도중 unmount가
   * 먼저 일어날 수 있으므로 각 페이지는 내부 `disposed` 플래그로 가드합니다.
   */
  mount(root: HTMLElement): void | Promise<void>;
  /** 타이머/이벤트/리소스를 정리합니다. */
  unmount(): void;
}

export type PageFactory = () => Page;
