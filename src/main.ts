import './style.css';
import { initRouter, ROUTES } from './utils/router';
import { LoadingPage } from './pages/LoadingPage';
import { MessagePage } from './pages/MessagePage';
import { DataLoadingPage } from './pages/DataLoadingPage';
import { ARCameraPage } from './pages/ARCameraPage';
import { ARAnimationPage } from './pages/ARAnimationPage';
import { PosterCameraPage } from './pages/PosterCameraPage';
import { PosterStylePage } from './pages/PosterStylePage';
import { PosterLoadingPage } from './pages/PosterLoadingPage';
import { PosterResultPage } from './pages/PosterResultPage';
import { PosterExhibitPage } from './pages/PosterExhibitPage';
import { LoadingTransitionPage } from './pages/LoadingTransitionPage';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app root not found');

const router = initRouter(app);

router
  .register(ROUTES.loading, () => new LoadingPage())
  .register(ROUTES.message, () => new MessagePage())
  .register(ROUTES.arLoading, () => new DataLoadingPage())
  .register(ROUTES.arCamera, () => new ARCameraPage())
  .register(ROUTES.arAnimation, () => new ARAnimationPage())
  .register(ROUTES.poster, () => new PosterCameraPage())
  .register(ROUTES.posterStyle, () => new PosterStylePage())
  .register(ROUTES.posterLoading, () => new PosterLoadingPage())
  .register(ROUTES.posterResult, () => new PosterResultPage())
  .register(ROUTES.posterExhibit, () => new PosterExhibitPage())
  .register(
    ROUTES.messageIntro,
    () =>
      new LoadingTransitionPage({
        label: '로딩 중...',
        durationMs: 300,
        next: ROUTES.message,
      }),
  )
  .register(
    ROUTES.posterIntro,
    () =>
      new LoadingTransitionPage({
        label: '로딩 중...',
        durationMs: 3000,
        next: ROUTES.poster,
      }),
  );

router.start();
