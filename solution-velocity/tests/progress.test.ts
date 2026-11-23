import { describe, expect, it } from 'vitest';
import {
  activityCompletion,
  activityWeight,
  deriveStageStatus,
  getTemplate,
  progressFromActivities,
  JOURNEY_TEMPLATES,
} from '../packages/shared/src/index.js';

describe('progress model', () => {
  it('is zero for an empty set and one when everything is complete', () => {
    expect(progressFromActivities([])).toBe(0);
    expect(
      progressFromActivities([
        { status: 'completed', priority: 'high' },
        { status: 'completed', priority: 'low' },
      ]),
    ).toBe(1);
  });

  it('weights by priority so a critical activity counts for more', () => {
    const criticalDone = progressFromActivities([
      { status: 'completed', priority: 'critical' },
      { status: 'not_started', priority: 'low' },
    ]);
    const lowDone = progressFromActivities([
      { status: 'not_started', priority: 'critical' },
      { status: 'completed', priority: 'low' },
    ]);
    expect(criticalDone).toBeGreaterThan(lowDone);
  });

  it('treats in-review as nearly done and blocked as barely started', () => {
    expect(activityCompletion({ status: 'in_review' })).toBeGreaterThan(activityCompletion({ status: 'in_progress' }));
    expect(activityCompletion({ status: 'blocked' })).toBeGreaterThan(activityCompletion({ status: 'not_started' }));
    expect(activityCompletion({ status: 'completed' })).toBe(1);
  });

  it('counts approvals and deliverables as extra weight', () => {
    const plain = activityWeight({ status: 'not_started', priority: 'high', hasDeliverable: false, hasApproval: false });
    const withEvidence = activityWeight({ status: 'not_started', priority: 'high', hasDeliverable: true, hasApproval: true });
    expect(withEvidence).toBeGreaterThan(plain);
  });
});

describe('stage state derivation', () => {
  const activities = [{ status: 'completed' as const, priority: 'high' as const }];

  it('marks a fully complete stage complete when no approval is pending', () => {
    expect(
      deriveStageStatus({ activities, blocked: false, approvalPending: false, isFirstIncomplete: false }),
    ).toBe('completed');
  });

  it('keeps a stage active while an approval is pending', () => {
    expect(deriveStageStatus({ activities, blocked: false, approvalPending: true, isFirstIncomplete: false })).toBe('active');
  });

  it('marks a stage blocked when work in it is blocked', () => {
    expect(
      deriveStageStatus({
        activities: [{ status: 'blocked', priority: 'high' }],
        blocked: true,
        approvalPending: false,
        isFirstIncomplete: true,
      }),
    ).toBe('blocked');
  });

  it('distinguishes upcoming from active', () => {
    expect(
      deriveStageStatus({
        activities: [{ status: 'not_started', priority: 'high' }],
        blocked: false,
        approvalPending: false,
        isFirstIncomplete: false,
        gated: true,
      }),
    ).toBe('upcoming');
    expect(
      deriveStageStatus({
        activities: [{ status: 'in_progress', priority: 'high' }],
        blocked: false,
        approvalPending: false,
        isFirstIncomplete: false,
      }),
    ).toBe('active');
  });
});

describe('journey templates', () => {
  it('exposes usable lifecycles with stages, milestones and activities', () => {
    expect(JOURNEY_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const template of JOURNEY_TEMPLATES) {
      expect(template.stages.length).toBeGreaterThan(2);
      for (const stage of template.stages) {
        expect(stage.milestone.length).toBeGreaterThan(3);
        expect(stage.activities.length).toBeGreaterThan(0);
        for (const activity of stage.activities) {
          expect(activity.title.length).toBeGreaterThan(3);
        }
      }
    }
  });

  it('falls back safely for an unknown template', () => {
    const fallback = getTemplate('does_not_exist');
    expect(fallback.key).toBe('generic');
  });
});
