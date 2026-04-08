// ============================================================
// 365 Pulse — Event bus (stub)
// Sprint 1 lands this as a no-op so later sprints can sprinkle emit() calls
// into mutation handlers cheaply. Sprint 5 plugs in real dispatch:
//   - in-app activity feed
//   - Discord channel notifications (matched against notification_rules)
//
// Usage from a route handler:
//   await emit(env, 'issue.assigned', { issue, assignee }, ctx);
//
// `ctx` is the Cloudflare execution context (the second arg of fetch handler).
// We use ctx.waitUntil() so emits never block the user-facing response.
// ============================================================

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
 * Emit an event. No-op stub for Sprint 1.
 *
 * @param {object} env       Cloudflare worker env bindings
 * @param {string} eventType One of EVENT_TYPES values
 * @param {object} payload   Arbitrary structured data describing what happened
 * @param {object} [ctx]     Worker execution context (for waitUntil); optional
 */
export async function emit(env, eventType, payload, ctx) {
  // Sprint 5 will:
  //   1. Insert a row into `activity` (entity_type/entity_id derived from payload)
  //   2. Look up matching `notification_rules` and dispatch via ctx.waitUntil()
  // For now we noop so calling sites can be wired up safely.
  if (!eventType) return;
  // Avoid unused-arg lint noise without doing real work:
  void env; void payload; void ctx;
}
