// ============================================================
// 365 Pulse — Event bus
// Sprint 1 landed this as a no-op so later sprints could sprinkle emit()
// calls into mutation handlers cheaply. Sprint 5 plugs in real dispatch:
//   - Discord channel notifications (matched against notification_rules)
// The in-app activity feed rows are still written directly by the handlers
// themselves; emit() is specifically the "fan-out to external systems" hook.
//
// Usage from a route handler:
//   await emit(env, EVENT_TYPES.ISSUE_ASSIGNED, { issue, assignee }, ctx);
//
// `ctx` is the Cloudflare execution context (the second arg of fetch handler).
// We use ctx.waitUntil() inside dispatchEvent so emits never block the
// user-facing response.
// ============================================================

import { dispatchEvent } from './discord.js';

// Known event types — keep this list as the canonical reference.
// Sprints 2-4 will add to it; Sprint 5 wires them up to Discord rules.
export const EVENT_TYPES = Object.freeze({
  // Sprint 2-3: Tasks
  ISSUE_CREATED:        'issue.created',
  ISSUE_UPDATED:        'issue.updated',
  ISSUE_ASSIGNED:       'issue.assigned',
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_COMMENTED:      'issue.commented',
  SPRINT_STARTED:       'sprint.started',
  SPRINT_COMPLETED:     'sprint.completed',

  // Sprint 4: Docs
  DOC_PAGE_CREATED:     'doc.page_created',
  DOC_PAGE_UPDATED:     'doc.page_updated',
  DOC_PAGE_COMMENTED:   'doc.page_commented',
  DOC_PAGE_DELETED:     'doc.page_deleted',

  // CRM (existing surfaces will adopt these gradually)
  CONTACT_STAGE_CHANGED: 'contact.stage_changed',
  CONTACT_FOLLOWUP_DUE:  'contact.followup_due',
});

/**
 * Emit an event. Sprint 5 wires Discord dispatch on top of what was a
 * no-op stub. Mention parsing is invoked DIRECTLY from handlers via
 * parseMentionsAndNotify() because not every event has a markdown body
 * — emit() doesn't handle that.
 *
 * @param {object} env       Cloudflare worker env bindings
 * @param {string} eventType One of EVENT_TYPES values
 * @param {object} payload   Arbitrary structured data describing what happened
 * @param {object} [ctx]     Worker execution context (for waitUntil); optional
 */
export async function emit(env, eventType, payload, ctx) {
  if (!eventType) return;
  try {
    await dispatchEvent(env, eventType, payload, ctx);
  } catch (e) {
    console.error('emit dispatch failed', eventType, e?.message || e);
  }
}
