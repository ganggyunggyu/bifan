/**
 * 전역 상태 관리 (간단한 옵저버블 스토어).
 * 외부 라이브러리 없이 구독/갱신만 제공합니다.
 */

export interface ExhibitSlot {
  id: number;
  occupied: boolean;
  posterImageUrl: string | null;
  timestamp: number;
}

export interface AppState {
  // 다운로드
  downloadProgress: number;
  downloadComplete: boolean;

  // AR 인식
  isTargetFound: boolean;
  targetFoundDuration: number;

  // 포스터 제작 (Phase 2/3에서 사용)
  capturedPhotos: File[]; // 인물 사진 1~4장(인물수 = 길이)
  selectedGenre: string;
  selectedMood: string;
  selectedLighting: string;
  selectedComposition: string;
  movieTitle: string;
  movieSubtitle: string;
  generatedPosterUrl: string | null;

  // 전시 (Phase 3)
  exhibitSlots: ExhibitSlot[];
  myPosterSlotId: number | null;
}

const initialState: AppState = {
  downloadProgress: 0,
  downloadComplete: false,
  isTargetFound: false,
  targetFoundDuration: 0,
  capturedPhotos: [],
  selectedGenre: '',
  selectedMood: '',
  selectedLighting: '',
  selectedComposition: '',
  movieTitle: '',
  movieSubtitle: '',
  generatedPosterUrl: null,
  exhibitSlots: [],
  myPosterSlotId: null,
};

type Listener = (state: Readonly<AppState>) => void;

class Store {
  private state: AppState = { ...initialState };
  private listeners = new Set<Listener>();

  get(): Readonly<AppState> {
    return this.state;
  }

  set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  reset(): void {
    this.state = { ...initialState };
    this.listeners.forEach((l) => l(this.state));
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export const appState = new Store();
