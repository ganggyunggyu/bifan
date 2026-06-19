import type { Page } from './Page';
import { createTopBar } from '../components/TopBar';
import { Dropdown } from '../components/Dropdown';
import { fileToDataUrl } from '../api/posterGenerate';
import {
  GENRE_OPTIONS,
  MOOD_OPTIONS,
  LIGHTING_OPTIONS,
  COMPOSITION_OPTIONS,
  RECOMMENDED_TITLES,
  RECOMMENDED_SUBTITLES,
  getPosterTitlePair,
} from '../config/posterOptions';
import { appState } from '../store/appState';
import { router, ROUTES } from '../utils/router';

/**
 * [Module B — Screen 8] 포스터 스타일 선택.
 * 사진 미리보기 + 4개 드롭다운 + 제목 입력 → 제작하기 → 생성 로딩.
 */
export class PosterStylePage implements Page {
  async mount(root: HTMLElement): Promise<void> {
    // 사진 없이 직접 진입 시 카메라로 되돌림.
    const photos = appState.get().capturedPhotos;
    if (!photos.length) {
      router.navigate(ROUTES.poster);
      return;
    }

    const screen = document.createElement('div');
    screen.className = 'screen poster-style-page scrollable';

    screen.appendChild(
      createTopBar({
        title: '영화 포스터 스타일 선택하기',
        onBack: () => router.navigate(ROUTES.poster),
      }),
    );

    const content = document.createElement('div');
    content.className = 'poster-style__content';

    // 사진 미리보기(첫 장) + 인물수 안내.
    const preview = document.createElement('img');
    preview.className = 'poster-style__preview';
    preview.alt = '선택한 사진';
    fileToDataUrl(photos[0]).then((url) => (preview.src = url));
    content.appendChild(preview);

    const peopleInfo = document.createElement('p');
    peopleInfo.className = 'poster-style__people';
    peopleInfo.textContent = `인물 ${photos.length}명으로 제작합니다`;
    content.appendChild(peopleInfo);

    // 드롭다운들 + 상태.
    const current = appState.get();
    const state = {
      genre: current.selectedGenre || GENRE_OPTIONS[0],
      mood: current.selectedMood || MOOD_OPTIONS[0],
      lighting: current.selectedLighting || LIGHTING_OPTIONS[0],
      composition: current.selectedComposition || COMPOSITION_OPTIONS[0],
    };

    const applyRandomTitle = (genreLabel: string): void => {
      const pair = getPosterTitlePair(genreLabel);
      titleInput.value = pair.ko;
      subtitleInput.value = pair.en;
      titleInput.placeholder = `예) ${RECOMMENDED_TITLES[genreLabel] ?? '부천에서 생긴 일'}`;
      subtitleInput.placeholder = `예) ${RECOMMENDED_SUBTITLES[genreLabel] ?? 'BIFAN POSTER'}`;
    };

    const genre = new Dropdown({
      label: '장르 선택',
      items: GENRE_OPTIONS,
      value: state.genre,
      onChange: (v) => {
        state.genre = v;
        applyRandomTitle(v);
      },
    });
    const mood = new Dropdown({
      label: '분위기 선택',
      items: MOOD_OPTIONS,
      value: state.mood,
      onChange: (v) => (state.mood = v),
    });
    const lighting = new Dropdown({
      label: '조명 선택',
      items: LIGHTING_OPTIONS,
      value: state.lighting,
      onChange: (v) => (state.lighting = v),
    });
    const composition = new Dropdown({
      label: '구도 선택',
      items: COMPOSITION_OPTIONS,
      value: state.composition,
      onChange: (v) => (state.composition = v),
    });
    content.append(genre.el, mood.el, lighting.el, composition.el);

    // 영화 제목 입력.
    const titleWrap = document.createElement('label');
    titleWrap.className = 'dropdown';
    const titleLabelRow = document.createElement('span');
    titleLabelRow.className = 'dropdown__label dropdown__label--row';
    const titleLabel = document.createElement('span');
    titleLabel.textContent = '영화 제목';
    const reroll = document.createElement('button');
    reroll.type = 'button';
    reroll.className = 'poster-title-reroll';
    reroll.textContent = '다른 제목';
    reroll.addEventListener('click', () => applyRandomTitle(state.genre));
    titleLabelRow.append(titleLabel, reroll);
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'text-input';
    titleInput.placeholder = `예) ${RECOMMENDED_TITLES[state.genre] ?? '부천에서 생긴 일'}`;
    titleInput.maxLength = 30;
    titleInput.value = current.movieTitle;
    titleWrap.append(titleLabelRow, titleInput);
    content.appendChild(titleWrap);

    const subtitleWrap = document.createElement('label');
    subtitleWrap.className = 'dropdown';
    const subtitleLabel = document.createElement('span');
    subtitleLabel.className = 'dropdown__label';
    subtitleLabel.textContent = '영문 부제';
    const subtitleInput = document.createElement('input');
    subtitleInput.type = 'text';
    subtitleInput.className = 'text-input';
    subtitleInput.placeholder = `예) ${RECOMMENDED_SUBTITLES[state.genre] ?? 'BIFAN POSTER'}`;
    subtitleInput.maxLength = 40;
    subtitleInput.value = current.movieSubtitle;
    subtitleWrap.append(subtitleLabel, subtitleInput);
    content.appendChild(subtitleWrap);

    if (!titleInput.value.trim()) {
      applyRandomTitle(state.genre);
    } else if (!subtitleInput.value.trim()) {
      subtitleInput.value = RECOMMENDED_SUBTITLES[state.genre] ?? '';
    }

    screen.appendChild(content);

    // 하단 버튼.
    const actions = document.createElement('div');
    actions.className = 'poster-style__actions';

    const make = document.createElement('button');
    make.className = 'btn btn-primary';
    make.textContent = '제작하기';
    make.addEventListener('click', () => {
      // 제목 미입력 시 장르 추천 제목을 사용.
      const title =
        titleInput.value.trim() || RECOMMENDED_TITLES[state.genre] || '';
      const subtitle =
        subtitleInput.value.trim() || RECOMMENDED_SUBTITLES[state.genre] || '';
      appState.set({
        selectedGenre: state.genre,
        selectedMood: state.mood,
        selectedLighting: state.lighting,
        selectedComposition: state.composition,
        movieTitle: title,
        movieSubtitle: subtitle,
      });
      router.navigate(ROUTES.posterLoading);
    });

    const retake = document.createElement('button');
    retake.className = 'btn btn-dark';
    retake.textContent = '다시 찍기';
    retake.addEventListener('click', () => router.navigate(ROUTES.poster));

    actions.append(make, retake);
    screen.appendChild(actions);

    root.appendChild(screen);
  }

  unmount(): void {
    /* no timers/streams */
  }
}
