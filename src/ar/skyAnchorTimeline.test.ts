import { describe, expect, it } from 'vitest';
import {
  SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS,
  SKY_ANCHOR_MODEL_VISIBLE_MS,
  SKY_ANCHOR_PROP_MODELS,
} from '../config/arConfig';
import {
  buildSkyAnchorTimeline,
  getActiveTimelineBatch,
} from './skyAnchorTimeline';

const timeline = buildSkyAnchorTimeline(SKY_ANCHOR_PROP_MODELS, {
  entryStaggerSeconds: SKY_ANCHOR_MODEL_ENTRY_STAGGER_MS / 1000,
  visibleSeconds: SKY_ANCHOR_MODEL_VISIBLE_MS / 1000,
});

describe('sky anchor timeline', () => {
  it('plays the chameleon intro before the GLB prop sequence', () => {
    const chameleon = timeline.items[0];
    const firstProp = timeline.items[1];

    expect(chameleon.intro).toBe(true);
    expect(chameleon.sequenceIndex).toBe(-1);
    expect(chameleon.delay).toBe(0);
    expect(chameleon.duration).toBeCloseTo(197 / 24, 5);

    expect(timeline.sequenceCount).toBe(16);
    expect(firstProp.sequenceIndex).toBe(0);
    expect(firstProp.delay).toBeCloseTo(chameleon.duration, 5);
  });

  it('starts prop batches only after the chameleon finishes', () => {
    const introEnd = timeline.introEndSeconds;

    expect(getActiveTimelineBatch(timeline, introEnd - 0.01, 2)).toBe(-1);
    expect(getActiveTimelineBatch(timeline, introEnd, 2)).toBe(0);
    expect(getActiveTimelineBatch(timeline, introEnd + 2.01, 2)).toBe(1);
  });
});
