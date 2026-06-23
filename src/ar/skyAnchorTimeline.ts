import type { SkyAnchorPropModel } from '../config/arConfig';

export interface SkyAnchorTimelineItem {
  index: number;
  sequenceIndex: number;
  delay: number;
  duration: number;
  persistent: boolean;
  intro: boolean;
}

export interface SkyAnchorTimelineOptions {
  entryStaggerSeconds: number;
  visibleSeconds: number;
}

export interface SkyAnchorTimeline {
  introEndSeconds: number;
  sequenceCount: number;
  items: SkyAnchorTimelineItem[];
}

export function isIntroPngSequence(
  descriptor: SkyAnchorPropModel,
  index: number,
): boolean {
  return index === 0 && descriptor.kind === 'png-sequence' && !!descriptor.sprite;
}

export function getDescriptorDurationSeconds(
  descriptor: SkyAnchorPropModel,
  visibleSeconds: number,
): number {
  if (descriptor.persistent) return Number.POSITIVE_INFINITY;
  if (descriptor.kind === 'png-sequence' && descriptor.sprite) {
    return Math.max(descriptor.sprite.frameCount / Math.max(descriptor.sprite.fps, 1), 0.1);
  }
  return visibleSeconds;
}

export function buildSkyAnchorTimeline(
  models: readonly SkyAnchorPropModel[],
  options: SkyAnchorTimelineOptions,
): SkyAnchorTimeline {
  let nextSequenceIndex = 0;
  const durations = models.map((model) =>
    getDescriptorDurationSeconds(model, options.visibleSeconds),
  );
  const introEndSeconds = models.reduce((end, model, index) => {
    if (!isIntroPngSequence(model, index)) return end;
    return Math.max(end, (model.delay ?? 0) + durations[index]);
  }, 0);

  const items = models.map<SkyAnchorTimelineItem>((model, index) => {
    const persistent = !!model.persistent;
    const intro = isIntroPngSequence(model, index);
    let sequenceIndex = -1;
    let delay = model.delay ?? 0;

    if (!persistent && !intro) {
      sequenceIndex = nextSequenceIndex;
      delay = model.delay ?? introEndSeconds + sequenceIndex * options.entryStaggerSeconds;
      nextSequenceIndex += 1;
    }

    return {
      index,
      sequenceIndex,
      delay,
      duration: durations[index],
      persistent,
      intro,
    };
  });

  return {
    introEndSeconds,
    sequenceCount: nextSequenceIndex,
    items,
  };
}

export function getActiveTimelineBatch(
  timeline: SkyAnchorTimeline,
  revealElapsedSeconds: number,
  entryStaggerSeconds: number,
): number {
  const propItems = timeline.items.filter((item) => !item.persistent && item.sequenceIndex >= 0);
  const firstPropDelay = propItems.reduce(
    (min, item) => Math.min(min, item.delay),
    Number.POSITIVE_INFINITY,
  );

  if (!propItems.length || revealElapsedSeconds < firstPropDelay) return -1;

  return Math.min(
    Math.floor((revealElapsedSeconds - firstPropDelay) / entryStaggerSeconds),
    propItems.length - 1,
  );
}
