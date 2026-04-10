// ============================================================
// Totally Wild AI — Outreach & CRM Worker
// Cloudflare Worker: API backend + serves dashboard
// Bindings required: DB (D1), KV (KV Namespace), UNSUBSCRIBES (KV — shared with email worker),
//                   ADMIN_USER, ADMIN_PASS (secrets — break-glass after Sprint 1 bootstrap)
//
// Unsubscribe handling is fully delegated to the 365soft-email-worker.
// Set MAIL_UNSUBSCRIBE_BASE_URL on that worker to enable signed token links.
// Set MAIL_UNSUBSCRIBE_NOTIFY_EMAIL on that worker for admin notifications.
//
// Sprint 1 (auth foundation): multi-user auth lives in worker/auth.js +
// worker/sessions.js. ADMIN_USER/ADMIN_PASS are bootstrapped into the users
// table on first login and remain valid as a parallel break-glass credential
// regardless of the DB password. Bearer tokens are now D1-backed session ids;
// the legacy KV `sess:*` keys are no longer read or written.
// ============================================================

import {
  hashPassword, verifyPassword,
  generateTotpSecret, verifyTotp,
  generateBackupCodes, findMatchingBackupCode,
  generateUserId,
} from './worker/auth.js';
import {
  createSession, getActiveSession, revokeSession,
  promotePendingTwoFactor, touchSession,
} from './worker/sessions.js';
import { emit } from './worker/events.js';
import {
  listProjects as tasksListProjects, createProject as tasksCreateProject,
  getProject as tasksGetProject, patchProject as tasksPatchProject, deleteProject as tasksDeleteProject,
  listIssues as tasksListIssues, createIssue as tasksCreateIssue,
  getIssue as tasksGetIssue, patchIssue as tasksPatchIssue, deleteIssue as tasksDeleteIssue,
  addIssueComment as tasksAddIssueComment, deleteActivity as tasksDeleteActivity,
} from './worker/tasks.js';
import {
  listProjectSprints, createSprint,
  getSprint, patchSprint, deleteSprint,
  startSprint, completeSprint,
  addIssuesToSprint, removeIssueFromSprint,
  getBurndown,
} from './worker/sprints.js';
import {
  listSpaces, createSpace, getSpace, patchSpace, deleteSpace,
  listSpacePages, createPage, getPage, patchPage, deletePage,
  listPageVersions, getPageVersion, restorePageVersion,
} from './worker/docs.js';
import {
  listNotifications, getUnreadCount, markRead, markAllRead, mentionSearch,
} from './worker/notifications.js';
import {
  listIntegrations, createIntegration, patchIntegration, deleteIntegration,
  listIntegrationRules, createIntegrationRule, deleteIntegrationRule,
  testIntegration, listIntegrationLog,
} from './worker/integrations.js';
import {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment,
  deleteAttachmentsForEntity,
} from './worker/attachments.js';
import {
  listLinks, createLink, deleteLink, deleteLinksForEntity, entitySearch,
} from './worker/entity-links.js';
import {
  getFeatureVisibility, patchFeatureVisibility, isFeatureAllowed,
} from './worker/app-settings.js';

const EMAIL_WORKER = 'https://email.365softlabs.com/api/send';
const DEFAULT_FROM = 'nick@365softlabs.com';
const DEFAULT_NAME = 'Nick | 365Soft Labs';
const CRM_PUBLIC_BASE_URL = 'https://projects.totallywild.ai';
function getAdsOptimiserRealEstateTemplates() {
  return [
    {
      id: 'seed_ao_re_snapshot_v2',
      name: 'Ads Optimiser - Snapshot Style',
      subject: 'Turn listing photos into video walkthroughs buyers will watch',
      html_body: renderSnapshotStyleTemplate()
    },
    {
      id: 'seed_ao_re_prestige_magazine_v2',
      name: 'Ads Optimiser - Prestige Magazine Style',
      subject: 'A premium video walkthrough from the same listing photo set',
      html_body: renderPrestigeMagazineTemplate()
    },
    {
      id: 'seed_ao_re_market_insight_v2',
      name: 'Ads Optimiser - Market Insight Style',
      subject: 'In a million-dollar market, listings need more than static images',
      html_body: renderMarketInsightTemplate()
    },
    {
      id: 'seed_ao_re_agent_update_v2',
      name: 'Ads Optimiser - Agent Update Style',
      subject: 'A simple way to turn still listing images into walkthrough video',
      html_body: renderAgentUpdateTemplate()
    },
    {
      id: 'seed_ao_re_luxury_homes_editorial_v3',
      name: 'Ads Optimiser - Luxury Homes Magazine Style',
      subject: 'Luxury listings deserve more than a static image gallery',
      html_body: renderLuxuryHomesEditorialTemplate(CRM_PUBLIC_BASE_URL)
    }
  ];
}

function renderBrandLockup(subtitle, dark = true) {
  return `<table role="presentation" cellspacing="0" cellpadding="0">
    <tr>
      <td style="width:46px;height:46px;border-radius:12px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);text-align:center;font-size:22px;font-weight:800;color:#ffffff;">AO</td>
      <td style="padding-left:12px;">
        <div style="font-size:18px;line-height:1.2;font-weight:700;color:${dark ? '#ffffff' : '#111827'};">Ads Optimiser</div>
        <div style="margin-top:4px;font-size:12px;line-height:1.4;color:${dark ? '#cbd5e1' : '#64748b'};">${subtitle}</div>
      </td>
    </tr>
  </table>`;
}

function renderVideoLinksPanel(title, note) {
  return `<div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${title}</div>
  <p style="margin:10px 0 18px;font-size:15px;line-height:1.6;color:#4b5563;">${note}</p>
  <table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:12px;">
    <tr>
      <td style="padding:0 12px 12px 0;">
        <a href="https://www.youtube.com/watch?v=replace-me" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#fe2c55;color:#ffffff;text-decoration:none;font-weight:700;">Watch sample on YouTube</a>
      </td>
      <td style="padding:0 0 12px 0;">
        <a href="https://app.adsoptimiser.com.au/media/videos/replace-me.mp4" style="display:inline-block;padding:13px 18px;border-radius:10px;background:#eff6ff;color:#1d4ed8;text-decoration:none;font-weight:700;border:1px solid #bfdbfe;">Open hosted video</a>
      </td>
    </tr>
  </table>`;
}

function renderFooter(note) {
  return `<tr>
    <td style="padding:20px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa;">
      <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#6b7280;">${note}</p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">Before sending, replace the sample video URLs with your YouTube link or your Ads Optimiser hosted video URL.</p>
      <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#9ca3af;">If this is not relevant for you, you can <a href="{{unsubscribe_url}}" style="color:#2563eb;text-decoration:none;">unsubscribe here</a>.</p>
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">{{physical_address}}</p>
    </td>
  </tr>`;
}

function renderLuxuryHomesFooter(origin = CRM_PUBLIC_BASE_URL) {
  const iconWrapStyle = 'display:inline-block;width:34px;height:34px;border-radius:999px;background:#eff6ff;text-decoration:none;text-align:center;vertical-align:middle;';
  const iconStyle = 'display:block;width:18px;height:18px;margin:8px auto;border:0;outline:none;text-decoration:none;';
  const instagramIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/instagram.png?v=3')}" width="18" height="18" alt="Instagram" style="${iconStyle}">`;
  const youtubeIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/youtube.png?v=3')}" width="18" height="18" alt="YouTube" style="${iconStyle}">`;
  const tiktokIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/tiktok.png?v=3')}" width="18" height="18" alt="TikTok" style="${iconStyle}">`;
  const facebookIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/facebook.png?v=3')}" width="18" height="18" alt="Facebook" style="${iconStyle}">`;
  const linkedinIcon = `<img src="${absoluteAssetUrl(origin, 'email-assets/social/linkedin.png?v=3')}" width="18" height="18" alt="LinkedIn" style="${iconStyle}">`;
  return `<tr>
    <td style="padding:24px 28px 28px;border-top:1px solid #e5e7eb;background:#fafafa;">
      <p style="margin:0 0 14px;font-size:13px;line-height:1.7;color:#6b7280;text-align:center;">Ads Optimiser helps luxury real estate agencies turn premium listing photography into polished video walkthrough campaigns.</p>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 14px;">
        <tr>
          <td align="center" style="padding:0 0 12px;">
            <a href="https://adsoptimiser.com.au/#signup" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Sign Up</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/terms.html" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Terms of use</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/privacy.html" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Privacy Policy</a>
            <span style="padding:0 10px;color:#cbd5e1;">|</span>
            <a href="https://adsoptimiser.com.au/#contact" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:700;">Contact us</a>
          </td>
        </tr>
        <tr>
          <td align="center">
            <table role="presentation" cellspacing="0" cellpadding="0">
              <tr>
                <td style="padding:0 5px;">
                  <a href="https://www.instagram.com/adsoptimiserapp" title="Instagram" style="${iconWrapStyle}">
                    ${instagramIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.youtube.com/@adsoptimiserapp" title="YouTube" style="${iconWrapStyle}">
                    ${youtubeIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.tiktok.com/@plainenglishcyber" title="TikTok" style="${iconWrapStyle}">
                    ${tiktokIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.facebook.com/profile.php?id=61587247657068" title="Facebook" style="${iconWrapStyle}">
                    ${facebookIcon}
                  </a>
                </td>
                <td style="padding:0 5px;">
                  <a href="https://www.linkedin.com/company/ads-optimiser-app" title="LinkedIn" style="${iconWrapStyle}">
                    ${linkedinIcon}
                  </a>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;">You're receiving this because we think you'd be a great fit for what we do.</p>
      <p style="margin:0 0 10px;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;">&copy; Ads Optimiser is a registered business name of Cintelis Pty Limited ABN 51 638 482 970. All rights reserved.</p>
      <p style="margin:0;font-size:12px;line-height:1.7;color:#9ca3af;text-align:center;"><a href="{{unsubscribe_url}}" style="color:#2563eb;text-decoration:none;">Unsubscribe</a><span style="padding:0 10px;color:#cbd5e1;">|</span>Ads Optimiser, Sunshine Coast, QLD.</p>
    </td>
  </tr>`;
}

function renderTemplateShell(inner, footerNote, outerBackground = '#f3f4f6', customFooter = '') {
  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background:${outerBackground};font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <!-- Replace the sample video links below before sending:
         1. https://www.youtube.com/watch?v=replace-me
         2. https://app.adsoptimiser.com.au/media/videos/replace-me.mp4
    -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${outerBackground};padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#ffffff;border-radius:18px;overflow:hidden;">
            ${inner}
            ${customFooter || renderFooter(footerNote)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function absoluteAssetUrl(origin, path) {
  const cleanPath = String(path || '').replace(/^\/+/, '');
  const cleanOrigin = String(origin || '').replace(/\/+$/, '');
  return cleanOrigin ? `${cleanOrigin}/${cleanPath}` : `/${cleanPath}`;
}

function renderSnapshotStyleTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px 28px 18px;background:#111827;">
        ${renderBrandLockup('Snapshot-style outreach for listing video', true)}
      </td>
    </tr>
    <tr>
      <td style="padding:30px 28px 14px;background:#eaf2ff;">
        <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Real estate marketing</div>
        <h1 style="margin:10px 0 12px;font-size:31px;line-height:1.12;color:#111827;">Turn static property photos into a standout walkthrough.</h1>
        <p style="margin:0;font-size:16px;line-height:1.7;color:#334155;">Hi {{name}}, if your team already has the listing image set, Ads Optimiser can turn it into a short branded video that feels stronger than a static gallery and lighter than a filmed on-site shoot.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:20px 28px 8px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:50%;padding:0 8px 12px 0;vertical-align:top;">
              <div style="padding:16px;border:1px solid #dbeafe;border-radius:14px;background:#f8fbff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Reuse what you have</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Exterior, living, kitchen, bedroom, amenity and floorplan images become one polished motion asset.</div>
              </div>
            </td>
            <td style="width:50%;padding:0 0 12px 8px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #fee2e2;border-radius:14px;background:#fff7f8;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fe2c55;">Use it everywhere</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Perfect for social reels, listing launches, appraisal decks, vendor updates and buyer nurture email.</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 22px;">
        <div style="padding:18px 20px;border-radius:16px;background:#0f172a;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc;">How agencies use it</div>
          <ol style="margin:12px 0 0 18px;padding:0;font-size:15px;line-height:1.85;color:#e2e8f0;">
            <li>Start with the still image set already prepared for the listing.</li>
            <li>Generate a short branded walkthrough with agent CTA and property highlights.</li>
            <li>Share a single motion asset anywhere the listing needs more attention.</li>
          </ol>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Sample walkthrough links', 'Use either a YouTube link or a direct Ads Optimiser hosted video link. Replace the sample URLs in this template before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:18px 20px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Easy next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.7;color:#374151;">Reply with one current listing and we can mock up the style of walkthrough your agency could use from the existing photo pack.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps agencies convert existing listing photography into ready-to-share video creative.'
  );
}

function renderPrestigeMagazineTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px;background:linear-gradient(135deg,#0f172a 0%,#111827 55%,#1d4ed8 100%);">
        ${renderBrandLockup('Prestige magazine-inspired presentation', true)}
        <div style="margin-top:26px;padding:26px;border:1px solid rgba(255,255,255,.16);border-radius:18px;background:rgba(255,255,255,.05);">
          <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#93c5fd;">Premium listing presentation</div>
          <h1 style="margin:12px 0 14px;font-size:34px;line-height:1.08;color:#ffffff;">Make prestige listings feel cinematic before the first inspection.</h1>
          <p style="margin:0;font-size:16px;line-height:1.7;color:#dbeafe;">Hi {{name}}, luxury property marketing often needs more presence than static images can deliver. Ads Optimiser turns the polished stills your agency already owns into a refined video walkthrough fit for premium campaigns and vendor-facing presentations.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:26px 28px 10px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding:0 10px 14px 0;vertical-align:top;">
              <div style="padding:18px;background:#f8fafc;border-radius:16px;border:1px solid #e2e8f0;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#64748b;">Use case</div>
                <div style="margin-top:10px;font-size:15px;line-height:1.65;color:#111827;">Prestige listing launches, premium suburb campaigns, agent profile marketing, and private buyer outreach.</div>
              </div>
            </td>
            <td style="padding:0 0 14px 10px;vertical-align:top;">
              <div style="padding:18px;background:#fff7f8;border-radius:16px;border:1px solid #ffe4ea;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#fe2c55;">Output</div>
                <div style="margin-top:10px;font-size:15px;line-height:1.65;color:#111827;">Elegant pacing, branded end frames, polished text overlays and a stronger luxury feel from the same source photography.</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:22px;border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Why agencies like it</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#1f2937;">It gives premium listings a stronger visual story without waiting on a separate video crew, and it lets your team move fast when a vendor wants standout presentation material now.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Featured walkthrough examples', 'Drop in a prestige sample from YouTube or link directly to an Ads Optimiser-hosted video before sending this message.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border-radius:18px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">Next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#e5eefb;">If you have a prestige property coming to market, reply with the still image set and we can show you how that listing could look as a polished walkthrough.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps prestige agencies present premium listings with more motion, polish and speed.'
  );
}

function renderMarketInsightTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:28px 28px 18px;background:#ffffff;">
        ${renderBrandLockup('Market-insight newsletter style', false)}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 22px;">
        <div style="padding:22px 24px;border-radius:18px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#dbeafe;">Market insight</div>
          <h1 style="margin:10px 0 12px;font-size:32px;line-height:1.1;color:#ffffff;">In a million-dollar market, static image galleries are not enough.</h1>
          <p style="margin:0;font-size:16px;line-height:1.7;color:#eff6ff;">Hi {{name}}, when buyers scroll faster and vendors expect more polish, a short walkthrough video can help a listing feel more substantial than a set of stills alone. Ads Optimiser lets agencies build that motion layer from the images they already have.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="width:33.33%;padding:0 10px 12px 0;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Source</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Existing listing photos and floorplans</div>
              </div>
            </td>
            <td style="width:33.33%;padding:0 10px 12px 10px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Output</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Short branded walkthrough video</div>
              </div>
            </td>
            <td style="width:33.33%;padding:0 0 12px 10px;vertical-align:top;">
              <div style="padding:16px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
                <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Channels</div>
                <div style="margin-top:8px;font-size:15px;line-height:1.6;color:#111827;">Social, email, appraisal and vendor updates</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 18px;">
        <div style="padding:18px 20px;border-left:4px solid #fe2c55;background:#fff7f8;border-radius:0 14px 14px 0;">
          <p style="margin:0;font-size:16px;line-height:1.75;color:#374151;">Instead of asking your team to source a separate video shoot for every listing, you can start with what is already in the campaign pack and turn it into a stronger piece of motion creative.</p>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Example market-facing video links', 'Replace these sample URLs with one YouTube example or one hosted Ads Optimiser video before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Quick idea</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#374151;">Send through one active listing and we can map how your image set could become a walkthrough asset for buyers, vendors and social promotion.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser gives agencies a faster way to add motion creative to listing campaigns without starting from scratch.'
  );
}

function renderAgentUpdateTemplate() {
  return renderTemplateShell(`
    <tr>
      <td style="padding:26px 28px;background:#f8fafc;border-bottom:1px solid #e5e7eb;">
        ${renderBrandLockup('Clean agent-update style outreach', false)}
      </td>
    </tr>
    <tr>
      <td style="padding:28px 28px 12px;">
        <p style="margin:0 0 12px;font-size:16px;line-height:1.7;color:#374151;">Hi {{name}},</p>
        <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;color:#111827;">A simple way to turn listing stills into walkthrough video.</h1>
        <p style="margin:0 0 14px;font-size:16px;line-height:1.7;color:#374151;">If your agency already has polished photography for a property, Ads Optimiser can turn those still images into a short branded walkthrough your team can use across campaign touchpoints.</p>
        <p style="margin:0;font-size:16px;line-height:1.7;color:#374151;">It is a practical way to make listings feel more dynamic without adding the time and coordination of a separate video production job for every property.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:18px 28px;">
        <div style="padding:18px 20px;border-radius:16px;background:#111827;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#93c5fd;">What the agency gets</div>
          <ul style="margin:12px 0 0 18px;padding:0;font-size:15px;line-height:1.8;color:#e5eefb;">
            <li>A short branded property walkthrough built from your listing images</li>
            <li>Creative you can reuse across social, email and vendor comms</li>
            <li>A stronger presentation layer for listings that need more attention</li>
          </ul>
        </div>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 12px;">
          <tr>
            <td style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:14px;background:#ffffff;">
              <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Good fit for</div>
              <div style="margin-top:8px;font-size:15px;line-height:1.65;color:#111827;">New listings, social launch assets, vendor updates, buyer nurture sequences and agent prospecting material.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 14px;">
        ${renderVideoLinksPanel('Sample video links', 'Replace these example links with a YouTube walkthrough or a hosted Ads Optimiser video before sending.')}
      </td>
    </tr>
    <tr>
      <td style="padding:0 28px 20px;">
        <div style="padding:20px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe;">
          <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#2563eb;">Next step</div>
          <p style="margin:10px 0 0;font-size:16px;line-height:1.75;color:#1f2937;">If you want, reply with one live listing and we can show you the type of walkthrough video your agency could generate from the current image set.</p>
        </div>
      </td>
    </tr>`, 'Ads Optimiser helps agencies create more movement and attention around listings using assets they already own.'
  );
}

function renderLuxuryHomesEditorialTemplate(origin = '') {
  const heroImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/hero-image.webp');
  const frame01ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-01.webp');
  const frame02ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-02.webp');
  const frame03ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-03.webp');
  const frame04ImageUrl = absoluteAssetUrl(origin, '/email-assets/luxury-homes/video-frame-04.webp');
  const signatureLogoUrl = absoluteAssetUrl(origin, '/email-assets/social/ao-signature.png?v=4');
  const signatureMailIconUrl = absoluteAssetUrl(origin, '/email-assets/social/mail.png?v=4');
  const signatureWebIconUrl = absoluteAssetUrl(origin, '/email-assets/social/web.png?v=4');
  const heroVideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7lqd15_65664d7224303b4f68cd726721cf60b3.mp4';
  const frame01VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kmj0v_7731260bdfda87a874ecde241502f860.mp4';
  const frame02VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7lhh07_aedff491cab6e9f26f4eb67a54285e92.mp4';
  const frame03VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kollr_5f4a7d29f0198333200b81234c225d3c.mp4';
  const frame04VideoUrl = 'https://tiktok-auth.adsoptimiser.com.au/api/media/videos%2Fvideo_mn7kpljx_c467daf3a0d990cd08aa76558c206bcb.mp4';
  return renderTemplateShell(`
    <tr>
      <td align="center" style="padding:34px 36px 18px;background:#ffffff;">
        <a href="https://adsoptimiser.com.au/" style="display:inline-block;text-decoration:none;">
          <table role="presentation" cellspacing="0" cellpadding="0">
            <tr>
              <td style="width:58px;height:58px;border-radius:16px;background:linear-gradient(135deg,#2563eb 0%,#06b6d4 100%);text-align:center;font-size:28px;font-weight:800;color:#ffffff;">AO</td>
              <td style="padding-left:14px;">
                <div style="font-size:22px;line-height:1.1;font-weight:700;color:#0f172a;">Ads Optimiser</div>
                <div style="margin-top:6px;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b;">Luxury homes magazine style</div>
              </td>
            </tr>
          </table>
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0 36px 18px;background:#ffffff;">
        <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#2563eb;">Luxury listing presentation</div>
        <h1 style="margin:14px 0 0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.08;font-weight:400;color:#1f2937;">Static luxury imagery can become a standing video walkthrough.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:0 24px 28px;background:#ffffff;">
        <a href="${heroVideoUrl}" style="display:block;text-decoration:none;">
          <img src="${heroImageUrl}" alt="Luxury home hero frame" style="width:100%;border:0;display:block;border-radius:18px;max-width:592px;" width="592" />
        </a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:0 36px 26px;background:#ffffff;">
        <a href="https://adsoptimiser.com.au/" style="display:inline-block;padding:14px 22px;border-radius:12px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:700;">Visit Ads Optimiser</a>
      </td>
    </tr>
    <tr>
      <td style="padding:0 42px 12px;background:#ffffff;">
        <p style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.32;font-weight:400;color:#595959;">Luxury homes need more than a static gallery when buyers are screening properties online.</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b5563;">Hi {{first_name}}, when {{company}} is marketing a prestige property, the photography is usually already excellent. Ads Optimiser turns that same image set into a polished walkthrough video so the listing feels more cinematic, more premium, and more memorable before the first inspection.</p>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.85;color:#4b5563;">Instead of organising a separate video production for every campaign, your agency can reuse the approved stills, layer in motion, sequencing, and branded framing, and send buyers or vendors a stronger presentation asset within the normal campaign cycle.</p>
        <p style="margin:0;font-size:16px;line-height:1.85;color:#4b5563;">That means one elegant creative can support launch emails, agent prospecting, social promotion, premium suburb campaigns, and vendor reporting while keeping the visual standard expected of high-value homes. You can also see more at <a href="https://adsoptimiser.com.au/" style="color:#2563eb;text-decoration:none;font-weight:700;">adsoptimiser.com.au</a>.</p>
      </td>
    </tr>
    <tr>
      <td style="padding:28px 24px 10px;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
          <tr>
            <td style="padding:0 10px 18px 0;width:50%;vertical-align:top;">
              <a href="${frame01VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame01ImageUrl}" alt="Video frame 1" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Front elevation reveal</div>
            </td>
            <td style="padding:0 0 18px 10px;width:50%;vertical-align:top;">
              <a href="${frame02VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame02ImageUrl}" alt="Video frame 2" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Kitchen and living sweep</div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 10px 0 0;width:50%;vertical-align:top;">
              <a href="${frame03VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame03ImageUrl}" alt="Video frame 3" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Primary suite sequence</div>
            </td>
            <td style="padding:0 0 0 10px;width:50%;vertical-align:top;">
              <a href="${frame04VideoUrl}" style="display:block;text-decoration:none;">
                <img src="${frame04ImageUrl}" alt="Video frame 4" style="width:100%;border:0;display:block;border-radius:14px;" width="271" />
              </a>
              <div style="padding-top:10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">Outdoor entertaining close</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 42px 0;background:#ffffff;">
        <p style="margin:0 0 18px;font-size:16px;line-height:1.85;color:#4b5563;">If you would like, reply with one current prestige listing and we can show you how that property could be presented as a polished walkthrough using the image set your team already has.</p>
        <p style="margin:0;font-size:16px;line-height:1.85;color:#4b5563;">Best regards,</p>
      </td>
    </tr>
    <tr>
      <td style="padding:24px 30px 0;background:#ffffff;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-top:1px solid #e5e7eb;">
          <tr>
            <td style="padding:24px 0 0;width:88px;vertical-align:top;">
              <img src="${signatureLogoUrl}" width="64" height="64" alt="Ads Optimiser" style="display:block;width:64px;height:64px;border:0;outline:none;text-decoration:none;">
            </td>
            <td style="padding:24px 0 0;vertical-align:top;">
              <p style="margin:0 0 4px;font-size:18px;line-height:1.4;font-weight:700;color:#111827;">Ads Optimiser Team</p>
              <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4b5563;">AI-Powered Ad Creatives Platform</p>
              <p style="margin:0 0 6px;font-size:14px;line-height:1.7;color:#4b5563;">
                <span style="display:inline-block;vertical-align:middle;margin-right:10px;">
                  <img src="${signatureMailIconUrl}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;">
                </span>
                <a href="mailto:admin@adsoptimiser.com.au" style="color:#2563eb;text-decoration:none;vertical-align:middle;">admin@adsoptimiser.com.au</a>
              </p>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#4b5563;">
                <span style="display:inline-block;vertical-align:middle;margin-right:10px;">
                  <img src="${signatureWebIconUrl}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;outline:none;text-decoration:none;">
                </span>
                <a href="https://adsoptimiser.com.au/" style="color:#2563eb;text-decoration:none;vertical-align:middle;font-weight:700;">adsoptimiser.com.au</a>
              </p>
              <p style="margin:0 0 10px;font-size:14px;line-height:1.7;color:#111827;">Polished walkthrough campaigns from premium property photography.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`, 'Ads Optimiser helps luxury real estate agencies turn premium listing photography into polished video walkthrough campaigns.'
    , '#f3f4f6', renderLuxuryHomesFooter()
  );
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const m = req.method;
    if (m === 'OPTIONS') return addCors(new Response(null, { status: 204 }));

    // Public (no session) auth endpoints
    if (path === '/api/auth/login' && m === 'POST') return addCors(await apiLogin(req, env));
    if (path === '/api/auth/totp/login' && m === 'POST') return addCors(await apiTotpLogin(req, env, false));
    if (path === '/api/auth/totp/login-backup' && m === 'POST') return addCors(await apiTotpLogin(req, env, true));
    if (path === '/api/auth/check' && m === 'GET') return addCors(await apiCheck(req, env));
    if (path === '/api/auth/logout' && m === 'POST') return addCors(await apiLogout(req, env));

    if (path.startsWith('/api/')) {
      const authCtx = await requireAuth(req, env);
      if (authCtx instanceof Response) return addCors(authCtx);
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(touchSession(env, authCtx.session.id));
      }
      return addCors(await route(req, env, url, path, authCtx));
    }
    return new Response('Not found', { status: 404 });
  },
  async scheduled(_, env) { await runScheduler(env); }
};

// ── Auth ─────────────────────────────────────────────────────
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function getToken(req) {
  const h = req.headers.get('Authorization') || '';
  return h.replace('Bearer ', '').trim() || null;
}

// Returns { session, user } on success, or a 401 Response on failure.
async function requireAuth(req, env) {
  const token = getToken(req);
  if (!token) return jres({ error: 'Unauthorized' }, 401);
  const ctx = await getActiveSession(env, token);
  if (!ctx) return jres({ error: 'Unauthorized' }, 401);
  if (ctx.session.is_2fa_pending) return jres({ error: '2FA required' }, 401);
  return ctx;
}

// Idempotently create the bootstrap admin from ADMIN_USER/ADMIN_PASS env secrets.
// Runs on every login attempt — safe because of UNIQUE(email) and INSERT OR IGNORE.
async function bootstrapAdminIfNeeded(env) {
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return;
  const adminEmail = String(env.ADMIN_USER).trim().toLowerCase();
  if (!adminEmail) return;
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(adminEmail).first();
  if (existing) return;
  const userId = generateUserId();
  const ts = now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO users (id, email, display_name, role, active, preferences, created_at)
     VALUES (?, ?, ?, 'admin', 1, '{}', ?)`
  ).bind(userId, adminEmail, 'Admin (bootstrap)', ts).run();
  // Re-read in case of insert race; whichever id won, attach the credential.
  const row = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(adminEmail).first();
  if (!row) return;
  const { hash, salt, iterations, algorithm } = await hashPassword(env.ADMIN_PASS);
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash = excluded.password_hash,
       salt = excluded.salt,
       algorithm = excluded.algorithm,
       iterations = excluded.iterations,
       updated_at = excluded.updated_at`
  ).bind(row.id, hash, salt, algorithm, iterations, ts, ts).run();
}

// Returns true if email+password matches the env-secret break-glass credential.
function isBreakGlass(env, email, password) {
  if (!env.ADMIN_USER || !env.ADMIN_PASS) return false;
  return String(email).trim().toLowerCase() === String(env.ADMIN_USER).trim().toLowerCase()
      && String(password) === String(env.ADMIN_PASS);
}

async function apiLogin(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? body.username ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return jres({ error: 'email and password required' }, 400);

  // Bootstrap the env-secret admin into the users table on first login.
  await bootstrapAdminIfNeeded(env);

  const breakGlass = isBreakGlass(env, email, password);
  const user = await env.DB.prepare(
    'SELECT id, email, role, active FROM users WHERE email=? AND active=1'
  ).bind(email).first();
  if (!user) return jres({ error: 'Invalid credentials' }, 401);

  let valid = breakGlass;
  if (!valid) {
    const cred = await env.DB.prepare(
      'SELECT password_hash, salt, iterations FROM user_credentials WHERE user_id=?'
    ).bind(user.id).first();
    if (cred) {
      valid = await verifyPassword(password, cred.password_hash, cred.salt, cred.iterations);
    }
  }
  if (!valid) return jres({ error: 'Invalid credentials' }, 401);

  // Break-glass intentionally bypasses MFA — that's the whole point of break-glass.
  // Mitigation: rotate ADMIN_PASS to a long random string post-bootstrap.
  const totpRow = !breakGlass
    ? await env.DB.prepare('SELECT enabled FROM user_totp WHERE user_id=?').bind(user.id).first()
    : null;
  const mfaEnabled = totpRow && Number(totpRow.enabled) === 1;

  if (mfaEnabled) {
    const session = await createSession(env, user.id, { is2faPending: true });
    return jres({ requires_totp: true, session_id: session.id });
  }
  const session = await createSession(env, user.id, {});
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), user.id).run();
  return jres({ token: session.id });
}

// Handles both /api/auth/totp/login (TOTP code) and /api/auth/totp/login-backup (backup code).
async function apiTotpLogin(req, env, useBackupCode) {
  const body = await req.json().catch(() => ({}));
  const sessionId = String(body.session_id || '').trim();
  const code = String(body.code || '').trim();
  if (!sessionId || !code) return jres({ error: 'session_id and code required' }, 400);

  const ctx = await getActiveSession(env, sessionId);
  if (!ctx || !ctx.session.is_2fa_pending) return jres({ error: 'Invalid or expired session' }, 401);

  let valid = false;
  if (useBackupCode) {
    const matchedId = await findMatchingBackupCode(env, ctx.user.id, code);
    if (matchedId) {
      await env.DB.prepare('UPDATE user_backup_codes SET used_at=? WHERE id=?').bind(now(), matchedId).run();
      valid = true;
    }
  } else {
    const totp = await env.DB.prepare(
      'SELECT secret FROM user_totp WHERE user_id=? AND enabled=1'
    ).bind(ctx.user.id).first();
    if (totp) valid = await verifyTotp(totp.secret, code);
  }
  if (!valid) return jres({ error: 'Invalid code' }, 401);

  const promoted = await promotePendingTwoFactor(env, sessionId);
  if (!promoted) return jres({ error: 'Session promotion failed' }, 500);
  await env.DB.prepare('UPDATE users SET last_login_at=? WHERE id=?').bind(now(), ctx.user.id).run();
  return jres({ token: sessionId });
}

async function apiLogout(req, env) {
  const t = getToken(req);
  if (t) await revokeSession(env, t);
  return jres({ ok: true });
}

// Public — no 401 on missing session, just returns {ok:false}.
async function apiCheck(req, env) {
  const t = getToken(req);
  if (!t) return jres({ ok: false });
  const ctx = await getActiveSession(env, t);
  if (!ctx || ctx.session.is_2fa_pending) return jres({ ok: false });
  return jres({ ok: true, user: publicUser(ctx.user) });
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name || '',
    role: u.role || 'member',
    preferences: u.preferences || {},
  };
}

// ── Sprint 6: /api/me helpers (saved filters + my open issues) ──
async function getMySavedFilters(env, authCtx) {
  const prefs = authCtx.user.preferences || {};
  const saved = prefs.saved_filters || {};
  return jres({ saved_filters: saved });
}

async function setMySavedFilters(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  // Body shape: {section: 'tasks'|'docs', filters: [...]} OR {saved_filters: {...}}
  const next = { ...(authCtx.user.preferences || {}) };
  next.saved_filters = next.saved_filters || {};
  if (body && body.section && Array.isArray(body.filters)) {
    next.saved_filters[body.section] = body.filters;
  } else if (body && typeof body.saved_filters === 'object') {
    next.saved_filters = body.saved_filters;
  } else {
    return jres({ error: 'Provide either {section, filters} or {saved_filters: {...}}' }, 400);
  }
  await env.DB.prepare('UPDATE users SET preferences=? WHERE id=?')
    .bind(JSON.stringify(next), authCtx.user.id).run();
  return jres({ ok: true, saved_filters: next.saved_filters });
}

async function getMyIssues(env, authCtx) {
  // Return up to 10 of the current user's open issues across all projects.
  // Order: priority desc (highest first), due_at asc (soonest first), updated_at desc.
  const PRIORITY_RANK = `CASE i.priority
    WHEN 'highest' THEN 5
    WHEN 'high'    THEN 4
    WHEN 'medium'  THEN 3
    WHEN 'low'     THEN 2
    WHEN 'lowest'  THEN 1
    ELSE 0 END`;
  const { results } = await env.DB.prepare(
    `SELECT i.id, i.issue_key, i.title, i.status, i.priority, i.type, i.due_at, i.updated_at, i.project_id
     FROM issues i
     WHERE i.active = 1
       AND i.assignee_id = ?
       AND i.status NOT IN ('done')
     ORDER BY ${PRIORITY_RANK} DESC,
              CASE WHEN i.due_at IS NULL THEN 1 ELSE 0 END,
              i.due_at ASC,
              i.updated_at DESC
     LIMIT 10`
  ).bind(authCtx.user.id).all();
  return jres({ issues: results || [] });
}

// ── Authenticated me/users/MFA endpoints ─────────────────────
async function apiGetMe(env, authCtx) {
  const totp = await env.DB.prepare(
    'SELECT enabled FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  const backupRow = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM user_backup_codes WHERE user_id=? AND used_at IS NULL'
  ).bind(authCtx.user.id).first();
  return jres({
    user: publicUser(authCtx.user),
    mfa_enabled: !!(totp && Number(totp.enabled) === 1),
    backup_codes_remaining: Number(backupRow?.n ?? 0),
  });
}

async function apiPatchMyPreferences(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const next = { ...(authCtx.user.preferences || {}) };
  if ('theme' in body) {
    const theme = String(body.theme || '').toLowerCase();
    if (theme !== 'light' && theme !== 'dark') return jres({ error: 'theme must be light or dark' }, 400);
    next.theme = theme;
  }
  await env.DB.prepare('UPDATE users SET preferences=? WHERE id=?')
    .bind(JSON.stringify(next), authCtx.user.id).run();
  return jres({ ok: true, preferences: next });
}

async function apiChangePassword(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const current = String(body.current || '');
  const next = String(body.next || '');
  if (!next || next.length < 8) return jres({ error: 'New password must be at least 8 characters' }, 400);
  const cred = await env.DB.prepare(
    'SELECT password_hash, salt, iterations FROM user_credentials WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!cred) return jres({ error: 'No credential on file' }, 400);
  const ok = await verifyPassword(current, cred.password_hash, cred.salt, cred.iterations);
  if (!ok) return jres({ error: 'Current password is incorrect' }, 401);
  const hashed = await hashPassword(next);
  const ts = now();
  await env.DB.prepare(
    `UPDATE user_credentials SET password_hash=?, salt=?, algorithm=?, iterations=?, updated_at=? WHERE user_id=?`
  ).bind(hashed.hash, hashed.salt, hashed.algorithm, hashed.iterations, ts, authCtx.user.id).run();
  return jres({ ok: true });
}

async function apiTotpSetup(req, env, authCtx) {
  const { secret, otpauthUri } = generateTotpSecret(authCtx.user.email);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO user_totp (user_id, secret, enabled, verified_at, created_at)
     VALUES (?, ?, 0, NULL, ?)
     ON CONFLICT(user_id) DO UPDATE SET secret=excluded.secret, enabled=0, verified_at=NULL`
  ).bind(authCtx.user.id, secret, ts).run();
  return jres({ secret, otpauth_uri: otpauthUri });
}

async function apiTotpVerify(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  const row = await env.DB.prepare(
    'SELECT secret FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!row) return jres({ error: 'TOTP not initialised — call /setup first' }, 400);
  const ok = await verifyTotp(row.secret, code);
  if (!ok) return jres({ error: 'Invalid code' }, 401);
  await env.DB.prepare(
    'UPDATE user_totp SET enabled=1, verified_at=? WHERE user_id=?'
  ).bind(now(), authCtx.user.id).run();
  // Issue initial backup codes on first MFA enable.
  const codes = await issueBackupCodes(env, authCtx.user.id);
  return jres({ ok: true, backup_codes: codes });
}

async function apiTotpDisable(req, env, authCtx) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || '').trim();
  const row = await env.DB.prepare(
    'SELECT secret, enabled FROM user_totp WHERE user_id=?'
  ).bind(authCtx.user.id).first();
  if (!row || Number(row.enabled) !== 1) return jres({ error: 'MFA not enabled' }, 400);
  const ok = await verifyTotp(row.secret, code);
  if (!ok) return jres({ error: 'Invalid code' }, 401);
  await env.DB.prepare('DELETE FROM user_totp WHERE user_id=?').bind(authCtx.user.id).run();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(authCtx.user.id).run();
  return jres({ ok: true });
}

async function apiRegenerateBackupCodes(env, authCtx) {
  const codes = await issueBackupCodes(env, authCtx.user.id);
  return jres({ ok: true, backup_codes: codes });
}

// Generates fresh backup codes, deletes any prior set, returns plain values.
async function issueBackupCodes(env, userId) {
  const generated = await generateBackupCodes();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(userId).run();
  const ts = now();
  for (const c of generated) {
    await env.DB.prepare(
      `INSERT INTO user_backup_codes (id, user_id, code_hash, salt, used_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`
    ).bind(uid(), userId, c.hash, c.salt, ts).run();
  }
  return generated.map(c => c.plain);
}

// ── User administration (admin role only) ───────────────────
async function apiListUsers(env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.email, u.display_name, u.role, u.active, u.created_at, u.last_login_at,
            CASE WHEN t.enabled=1 THEN 1 ELSE 0 END AS mfa_enabled
     FROM users u LEFT JOIN user_totp t ON t.user_id = u.id
     ORDER BY u.created_at ASC`
  ).all();
  return jres({ users: results || [] });
}

async function apiCreateUser(req, env) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const display_name = String(body.display_name || '').trim();
  const role = ['admin', 'member', 'viewer'].includes(body.role) ? body.role : 'member';
  const password = String(body.password || '');
  if (!email) return jres({ error: 'email required' }, 400);
  if (!password || password.length < 8) return jres({ error: 'password must be at least 8 characters' }, 400);
  const exists = await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
  if (exists) return jres({ error: 'A user with that email already exists' }, 409);
  const id = generateUserId();
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, role, active, preferences, created_at)
     VALUES (?, ?, ?, ?, 1, '{}', ?)`
  ).bind(id, email, display_name, role, ts).run();
  const { hash, salt, iterations, algorithm } = await hashPassword(password);
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, hash, salt, algorithm, iterations, ts, ts).run();
  return jres({ id, email, display_name, role });
}

async function apiUpdateUser(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const fields = [];
  const vals = [];
  if ('display_name' in body) { fields.push('display_name=?'); vals.push(String(body.display_name || '')); }
  if ('role' in body && ['admin', 'member', 'viewer'].includes(body.role)) {
    fields.push('role=?'); vals.push(body.role);
  }
  if ('active' in body) { fields.push('active=?'); vals.push(body.active ? 1 : 0); }
  if (!fields.length) return jres({ error: 'No fields to update' }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE users SET ${fields.join(',')} WHERE id=?`).bind(...vals).run();
  return jres({ ok: true });
}

async function apiAdminResetPassword(req, env, id) {
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || '');
  if (!password || password.length < 8) return jres({ error: 'password must be at least 8 characters' }, 400);
  const user = await env.DB.prepare('SELECT id FROM users WHERE id=?').bind(id).first();
  if (!user) return jres({ error: 'User not found' }, 404);
  const { hash, salt, iterations, algorithm } = await hashPassword(password);
  const ts = now();
  await env.DB.prepare(
    `INSERT INTO user_credentials (user_id, password_hash, salt, algorithm, iterations, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       password_hash=excluded.password_hash, salt=excluded.salt,
       algorithm=excluded.algorithm, iterations=excluded.iterations, updated_at=excluded.updated_at`
  ).bind(id, hash, salt, algorithm, iterations, ts, ts).run();
  return jres({ ok: true });
}

async function apiAdminResetMfa(env, id) {
  await env.DB.prepare('DELETE FROM user_totp WHERE user_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM user_backup_codes WHERE user_id=?').bind(id).run();
  return jres({ ok: true });
}

async function apiDeleteUser(env, id) {
  // Soft delete — preserve audit trail.
  await env.DB.prepare('UPDATE users SET active=0 WHERE id=?').bind(id).run();
  // Revoke all live sessions for the deactivated user.
  await env.DB.prepare(
    'UPDATE app_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL'
  ).bind(now(), id).run();
  return jres({ ok: true });
}

// Sprint 6: feature-visibility URL prefix → feature key map.
// Admins always see everything; non-admins are blocked at the router on
// any path matching a disabled feature. Order matters slightly: longest
// prefix wins if there's overlap (none today, but be defensive).
const FEATURE_GATES = [
  { prefix: '/api/templates',    feature: 'outreach' },
  { prefix: '/api/contacts',     feature: 'outreach' },
  { prefix: '/api/lists',        feature: 'outreach' },
  { prefix: '/api/campaigns',    feature: 'outreach' },
  { prefix: '/api/logs',         feature: 'outreach' },
  { prefix: '/api/unsubscribes', feature: 'outreach' },
  { prefix: '/api/crm',          feature: 'crm' },
  { prefix: '/api/projects',     feature: 'tasks' },
  { prefix: '/api/issues',       feature: 'tasks' },
  { prefix: '/api/sprints',      feature: 'tasks' },
  { prefix: '/api/doc-spaces',   feature: 'docs' },
  { prefix: '/api/doc-pages',    feature: 'docs' },
];

// ── Router ───────────────────────────────────────────────────
async function route(req, env, url, path, authCtx) {
  const m = req.method;

  // Role gating: viewers are read-only across the entire API surface.
  // Admin/member roles fall through to the per-endpoint logic below.
  if (WRITE_METHODS.has(m) && authCtx.user.role === 'viewer') {
    return jres({ error: 'Forbidden: read-only role' }, 403);
  }

  // Sprint 6: feature visibility gate. Admin bypasses; others get 403 on
  // any URL matching a feature their role can't see.
  if (authCtx.user.role !== 'admin') {
    for (const gate of FEATURE_GATES) {
      if (path.startsWith(gate.prefix)) {
        const allowed = await isFeatureAllowed(env, gate.feature, authCtx.user.role);
        if (!allowed) return jres({ error: `The ${gate.feature} feature is disabled for your role` }, 403);
        break;
      }
    }
  }

  // ── Account / self-service auth endpoints ─────────────────
  if (path === '/api/me' && m === 'GET') return apiGetMe(env, authCtx);
  if (path === '/api/me/preferences' && m === 'PATCH') return apiPatchMyPreferences(req, env, authCtx);
  if (path === '/api/auth/password/change' && m === 'POST') return apiChangePassword(req, env, authCtx);
  if (path === '/api/auth/totp/setup' && m === 'POST') return apiTotpSetup(req, env, authCtx);
  if (path === '/api/auth/totp/verify' && m === 'POST') return apiTotpVerify(req, env, authCtx);
  if (path === '/api/auth/totp/disable' && m === 'POST') return apiTotpDisable(req, env, authCtx);
  if (path === '/api/auth/backup-codes/regenerate' && m === 'POST') return apiRegenerateBackupCodes(env, authCtx);

  // ── User administration ──────────────────────────────────
  // GET /api/users is available to all authenticated users (needed for assignee
  // dropdowns, @mention autocomplete, etc.). Write operations stay admin-only.
  if (path === '/api/users' && m === 'GET') {
    return apiListUsers(env);
  }
  if (path === '/api/users' && m === 'POST') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return apiCreateUser(req, env);
  }
  {
    const userMatch = path.match(/^\/api\/users\/([^/]+)(?:\/(reset-password|reset-mfa))?$/);
    if (userMatch) {
      if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
      const userId = userMatch[1];
      const action = userMatch[2];
      if (!action && m === 'PATCH') return apiUpdateUser(req, env, userId);
      if (!action && m === 'DELETE') return apiDeleteUser(env, userId);
      if (action === 'reset-password' && m === 'POST') return apiAdminResetPassword(req, env, userId);
      if (action === 'reset-mfa' && m === 'POST') return apiAdminResetMfa(env, userId);
    }
  }

  // ── Sprint 6: attachments + entity links + saved filters + app settings ──
  if (path === '/api/attachments' && m === 'GET')  return listAttachments(req, env);
  if (path === '/api/attachments' && m === 'POST') return uploadAttachment(req, env, authCtx);
  {
    const am = path.match(/^\/api\/attachments\/([^/]+)\/(download|preview)$/);
    if (am && m === 'GET') return downloadAttachment(env, am[1], am[2] === 'preview');
  }
  {
    const am = path.match(/^\/api\/attachments\/([^/]+)$/);
    if (am && m === 'DELETE') return deleteAttachment(env, authCtx, am[1]);
  }

  if (path === '/api/entity-links' && m === 'GET')  return listLinks(req, env);
  if (path === '/api/entity-links' && m === 'POST') return createLink(req, env, authCtx);
  {
    const lm = path.match(/^\/api\/entity-links\/([^/]+)$/);
    if (lm && m === 'DELETE') return deleteLink(env, authCtx, lm[1]);
  }
  if (path === '/api/entity-search' && m === 'GET') return entitySearch(req, env);

  if (path === '/api/me/saved-filters' && m === 'GET') return getMySavedFilters(env, authCtx);
  if (path === '/api/me/saved-filters' && m === 'PUT') return setMySavedFilters(req, env, authCtx);
  if (path === '/api/me/my-issues' && m === 'GET') return getMyIssues(env, authCtx);

  if (path === '/api/app-settings/feature-visibility' && m === 'GET') {
    return getFeatureVisibility(env).then(v => jres(v));
  }
  if (path === '/api/app-settings/feature-visibility' && m === 'PATCH') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return patchFeatureVisibility(req, env, authCtx);
  }

  // ── Notifications + Integrations (Sprint 5) ──────────────
  if (path === '/api/me/notifications' && m === 'GET') return listNotifications(req, env, authCtx);
  if (path === '/api/me/notifications/unread-count' && m === 'GET') return getUnreadCount(env, authCtx);
  if (path === '/api/me/notifications/read-all' && m === 'POST') return markAllRead(env, authCtx);
  {
    const nm = path.match(/^\/api\/me\/notifications\/([^/]+)\/read$/);
    if (nm && m === 'POST') return markRead(env, authCtx, nm[1]);
  }
  if (path === '/api/users/mention-search' && m === 'GET') return mentionSearch(req, env);

  if (path === '/api/integrations' && m === 'GET') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return listIntegrations(env);
  }
  if (path === '/api/integrations' && m === 'POST') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return createIntegration(req, env, authCtx);
  }
  {
    const im = path.match(/^\/api\/integrations\/([^/]+)(?:\/(rules|test))?$/);
    if (im) {
      if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
      const intId = im[1];
      const sub = im[2];
      if (!sub) {
        if (m === 'PATCH')  return patchIntegration(req, env, intId);
        if (m === 'DELETE') return deleteIntegration(env, intId);
      }
      if (sub === 'rules') {
        if (m === 'GET')  return listIntegrationRules(env, intId);
        if (m === 'POST') return createIntegrationRule(req, env, intId);
      }
      if (sub === 'test' && m === 'POST') return testIntegration(env, intId);
    }
  }
  {
    const irm = path.match(/^\/api\/integration-rules\/([^/]+)$/);
    if (irm && m === 'DELETE') {
      if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
      return deleteIntegrationRule(env, irm[1]);
    }
  }
  if (path === '/api/integration-log' && m === 'GET') {
    if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
    return listIntegrationLog(env);
  }

  // ── Docs (Sprint 4) ──────────────────────────────────────
  if (path === '/api/doc-spaces' && m === 'GET')  return listSpaces(env);
  if (path === '/api/doc-spaces' && m === 'POST') return createSpace(req, env, authCtx);
  {
    const spm = path.match(/^\/api\/doc-spaces\/([^/]+)(?:\/(pages))?$/);
    if (spm) {
      const spId = spm[1];
      const sub = spm[2];
      if (!sub) {
        if (m === 'GET')    return getSpace(env, spId);
        if (m === 'PATCH')  return patchSpace(req, env, spId);
        if (m === 'DELETE') {
          if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
          return deleteSpace(env, spId);
        }
      }
      if (sub === 'pages') {
        if (m === 'GET')  return listSpacePages(env, spId);
        if (m === 'POST') return createPage(req, env, authCtx, spId);
      }
    }
  }
  {
    const dpm = path.match(/^\/api\/doc-pages\/([^/]+)(?:\/versions(?:\/([^/]+)(?:\/(restore))?)?)?$/);
    if (dpm) {
      const pgId = dpm[1];
      const verId = dpm[2];
      const restore = dpm[3];
      // /api/doc-pages/:id  (no /versions sub)
      if (!verId && !path.includes('/versions')) {
        if (m === 'GET')    return getPage(env, pgId);
        if (m === 'PATCH')  return patchPage(req, env, authCtx, pgId);
        if (m === 'DELETE') return deletePage(env, pgId);
      }
      // /api/doc-pages/:id/versions
      if (path.endsWith('/versions') && m === 'GET') return listPageVersions(env, pgId);
      // /api/doc-pages/:id/versions/:versionId
      if (verId && !restore && m === 'GET') return getPageVersion(env, pgId, verId);
      // /api/doc-pages/:id/versions/:versionId/restore
      if (verId && restore === 'restore' && m === 'POST') return restorePageVersion(req, env, authCtx, pgId, verId);
    }
  }

  // ── Tasks (Sprint 2 + Sprint 3 sprints sub) ──────────────
  if (path === '/api/projects' && m === 'GET')  return tasksListProjects(env);
  if (path === '/api/projects' && m === 'POST') return tasksCreateProject(req, env, authCtx);
  {
    const pm = path.match(/^\/api\/projects\/([^/]+)(?:\/(issues|sprints))?$/);
    if (pm) {
      const projId = pm[1];
      const sub = pm[2];
      if (!sub) {
        if (m === 'GET')    return tasksGetProject(env, projId);
        if (m === 'PATCH')  return tasksPatchProject(req, env, projId);
        if (m === 'DELETE') {
          if (authCtx.user.role !== 'admin') return jres({ error: 'Forbidden: admin only' }, 403);
          return tasksDeleteProject(env, projId);
        }
      }
      if (sub === 'issues') {
        if (m === 'GET')  return tasksListIssues(req, env, projId);
        if (m === 'POST') return tasksCreateIssue(req, env, authCtx, projId);
      }
      if (sub === 'sprints') {
        if (m === 'GET')  return listProjectSprints(env, projId);
        if (m === 'POST') return createSprint(req, env, authCtx, projId);
      }
    }
  }
  // ── Sprints (Sprint 3) ───────────────────────────────────
  {
    const sm = path.match(/^\/api\/sprints\/([^/]+)(?:\/(start|complete|burndown|issues(?:\/([^/]+))?))?$/);
    if (sm) {
      const sprId = sm[1];
      const action = sm[2];
      const issueIdInPath = sm[3];
      if (!action) {
        if (m === 'GET')    return getSprint(env, sprId);
        if (m === 'PATCH')  return patchSprint(req, env, sprId);
        if (m === 'DELETE') return deleteSprint(env, sprId);
      }
      if (action === 'start' && m === 'POST')    return startSprint(env, authCtx, sprId);
      if (action === 'complete' && m === 'POST') return completeSprint(req, env, authCtx, sprId);
      if (action === 'burndown' && m === 'GET')  return getBurndown(env, sprId);
      if (sm[2] && sm[2].startsWith('issues') && !issueIdInPath && m === 'POST') {
        return addIssuesToSprint(req, env, authCtx, sprId);
      }
      if (sm[2] && sm[2].startsWith('issues') && issueIdInPath && m === 'DELETE') {
        return removeIssueFromSprint(env, authCtx, sprId, issueIdInPath);
      }
    }
  }
  {
    const im = path.match(/^\/api\/issues\/([^/]+)(?:\/(comments))?$/);
    if (im) {
      const isId = im[1];
      const sub = im[2];
      if (!sub) {
        if (m === 'GET')    return tasksGetIssue(env, isId);
        if (m === 'PATCH')  return tasksPatchIssue(req, env, authCtx, isId);
        if (m === 'DELETE') return tasksDeleteIssue(env, isId);
      }
      if (sub === 'comments' && m === 'POST') return tasksAddIssueComment(req, env, authCtx, isId);
    }
  }
  {
    const am = path.match(/^\/api\/activity\/([^/]+)$/);
    if (am && m === 'DELETE') return tasksDeleteActivity(env, authCtx, am[1]);
  }

  // ── Existing CRM / outreach segment-based routing ─────────
  const parts = path.replace('/api/', '').split('/');
  const [res, id, sub, sub2] = parts;
  if ((res === 'stats' || res === 'overview') && m === 'GET') return getOverview(env, url);
  if (res === 'templates') {
    if (m === 'POST' && id === 'seed' && sub === 'real-estate') return seedAdsOptimiserRealEstateTemplates(env);
    if (m === 'GET' && !id) return listTemplates(env);
    if (m === 'GET' && id) return getTemplate(env, id);
    if (m === 'POST' && !id) return createTemplate(req, env);
    if (m === 'PUT' && id) return updateTemplate(req, env, id);
    if (m === 'DELETE' && id) return deleteTemplate(env, id);
  }
  if (res === 'contacts') {
    if (m === 'GET' && !id) return listContacts(env, url);
    if (m === 'POST' && id === 'import') return importContacts(req, env);
    if (m === 'POST' && !id) return createContact(req, env);
    if (m === 'PUT' && id) return updateContact(req, env, id);
    if (m === 'DELETE' && id) return deleteContact(env, id);
  }
  if (res === 'lists') {
    if (m === 'GET' && !id) return listLists(env);
    if (m === 'POST' && !id) return createList(req, env);
    if (m === 'PUT' && id && !sub) return updateList(req, env, id);
    if (m === 'DELETE' && id && !sub) return deleteList(env, id);
    if (m === 'GET' && id && sub === 'contacts') return getListContacts(env, id);
    if (m === 'POST' && id && sub === 'contacts') return addToList(req, env, id);
    if (m === 'DELETE' && id && sub === 'contacts' && sub2) return removeFromList(env, id, sub2);
  }
  if (res === 'campaigns') {
    if (m === 'GET' && !id) return listCampaigns(env);
    if (m === 'POST' && !id) return createCampaign(req, env);
    if (m === 'PUT' && id && !sub) return updateCampaign(req, env, id);
    if (m === 'DELETE' && id && !sub) return deleteCampaign(env, id);
    if (m === 'POST' && id && sub === 'send') return sendNow(env, id);
    if (m === 'POST' && id && sub === 'activate') return setCampaignStatus(env, id, 'active');
    if (m === 'POST' && id && sub === 'pause') return setCampaignStatus(env, id, 'paused');
  }
  if (res === 'logs' && m === 'GET') return getLogs(env, url);
  if (res === 'unsubscribes' && m === 'GET') return getUnsubscribes(env);
  // ── CRM routes ───────────────────────────────────────────────
  if (res === 'crm') {
    if (id === 'pipeline' && m === 'GET') return getCrmPipeline(env);
    if (id === 'stats' && m === 'GET') return getCrmStats(env);
    if (id === 'followups' && m === 'GET') return getFollowUps(env);
    if (id === 'contact' && sub && !sub2) {
      if (m === 'GET') return getContactDetail(env, sub);
      if (m === 'PATCH') return patchContact(req, env, sub);
    }
    if (id === 'contact' && sub && sub2 === 'notes') {
      if (m === 'GET') return getNotes(env, sub);
      if (m === 'POST') return addNote(req, env, sub);
    }
    if (id === 'contact' && sub && sub2 && parts[4] === undefined && m === 'DELETE') {
      return deleteNote(env, sub2);
    }
  }
  return jres({ error: 'Not found' }, 404);
}

// ── Stats ────────────────────────────────────────────────────
async function getStats(env, url) {
  return getOverview(env, url);
}

function normalizeOverviewRange(value) {
  const allowed = new Set(['7d', '30d', 'month', 'all']);
  const range = String(value || 'all').toLowerCase();
  return allowed.has(range) ? range : 'all';
}

function getOverviewDateFilter(range, column) {
  if (range === '7d') return ` AND datetime(${column}) >= datetime('now', '-7 days')`;
  if (range === '30d') return ` AND datetime(${column}) >= datetime('now', '-30 days')`;
  if (range === 'month') return ` AND datetime(${column}) >= datetime('now', 'start of month')`;
  return '';
}

async function contactHasColumn(env, columnName) {
  const { results } = await env.DB.prepare('PRAGMA table_info(contacts)').all();
  return (results || []).some(column => String(column.name || '').toLowerCase() === String(columnName || '').toLowerCase());
}

async function getOverview(env, url) {
  await ensureContactProfileTable(env);
  const range = normalizeOverviewRange(url?.searchParams?.get('range'));
  const sentFilter = getOverviewDateFilter(range, 'sent_at');
  const recentSendsFilter = getOverviewDateFilter(range, 'sent_at');
  const noteActivityFilter = getOverviewDateFilter(range, 'n.created_at');
  const emailActivityFilter = getOverviewDateFilter(range, 's.sent_at');
  const wonDateColumn = await contactHasColumn(env, 'updated_at') ? 'updated_at' : 'created_at';
  const wonRangeFilter = getOverviewDateFilter(range, wonDateColumn);

  const [
    contacts,
    templates,
    campaigns,
    sent,
    pipelineValue,
    followUps,
    stageRows,
    wonInRange,
    recentSends,
    recentActivity
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM contacts WHERE unsubscribed=0').first(),
    env.DB.prepare('SELECT COUNT(*) n FROM templates').first(),
    env.DB.prepare('SELECT COUNT(*) n FROM campaigns WHERE status NOT IN ("draft","completed")').first(),
    env.DB.prepare(`SELECT COUNT(*) n FROM sent_log WHERE status="sent"${sentFilter}`).first(),
    env.DB.prepare('SELECT COALESCE(SUM(deal_value),0) v FROM contacts WHERE unsubscribed=0 AND stage NOT IN ("lost","won")').first(),
    env.DB.prepare(`
      SELECT
        COALESCE(SUM(CASE
          WHEN follow_up_at IS NOT NULL
            AND date(follow_up_at) < date('now')
            AND stage NOT IN ('won','lost')
          THEN 1 ELSE 0 END), 0) overdue,
        COALESCE(SUM(CASE
          WHEN follow_up_at IS NOT NULL
            AND date(follow_up_at) = date('now')
            AND stage NOT IN ('won','lost')
          THEN 1 ELSE 0 END), 0) today
      FROM contacts
      WHERE unsubscribed=0
    `).first(),
    env.DB.prepare(`
      SELECT stage, COUNT(*) count, COALESCE(SUM(deal_value),0) value
      FROM contacts
      WHERE unsubscribed=0
      GROUP BY stage
    `).all(),
    env.DB.prepare(`
      SELECT COUNT(*) count, COALESCE(SUM(deal_value),0) value
      FROM contacts
      WHERE unsubscribed=0
        AND stage='won'${wonRangeFilter}
    `).first(),
    env.DB.prepare(`
      SELECT id, campaign_name, contact_email, subject, status, sent_at
      FROM sent_log
      WHERE 1=1${recentSendsFilter}
      ORDER BY sent_at DESC
      LIMIT 10
    `).all(),
    env.DB.prepare(`
      SELECT id, contact_id, contact_name, contact_email, type, body, created_at
      FROM (
        SELECT
          n.id,
          n.entity_id contact_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(cp.first_name,'') || ' ' || COALESCE(cp.last_name,'')), ''),
            NULLIF(c.name, ''),
            c.email
          ) contact_name,
          c.email contact_email,
          LOWER(COALESCE(n.kind, 'note')) type,
          n.body_md body,
          n.created_at
        FROM activity n
        JOIN contacts c ON c.id = n.entity_id
        LEFT JOIN contact_profiles cp ON cp.contact_id = n.entity_id
        WHERE n.entity_type = 'contact'${noteActivityFilter}

        UNION ALL

        SELECT
          s.id,
          s.contact_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(cp.first_name,'') || ' ' || COALESCE(cp.last_name,'')), ''),
            NULLIF(c.name, ''),
            s.contact_email
          ) contact_name,
          COALESCE(c.email, s.contact_email) contact_email,
          'email' type,
          COALESCE(NULLIF(s.subject, ''), 'Email sent') body,
          s.sent_at created_at
        FROM sent_log s
        LEFT JOIN contacts c ON c.id = s.contact_id
        LEFT JOIN contact_profiles cp ON cp.contact_id = s.contact_id
        WHERE 1=1${emailActivityFilter}
      ) activity
      ORDER BY created_at DESC
      LIMIT 15
    `).all()
  ]);

  const stageLookup = {};
  for (const row of stageRows?.results || []) {
    stageLookup[row.stage] = {
      count: Number(row.count || 0),
      value: Number(row.value || 0)
    };
  }

  const pipelineStages = ['lead', 'prospect', 'qualified', 'proposal'].map(stage => ({
    stage,
    count: stageLookup[stage]?.count || 0,
    value: stageLookup[stage]?.value || 0
  }));

  return jres({
    range,
    contacts: Number(contacts?.n || 0),
    templates: Number(templates?.n || 0),
    campaigns: Number(campaigns?.n || 0),
    sent: Number(sent?.n || 0),
    pipeline_value: Number(pipelineValue?.v || 0),
    follow_ups_overdue: Number(followUps?.overdue || 0),
    follow_ups_today: Number(followUps?.today || 0),
    pipeline_stages: pipelineStages,
    won: {
      count: stageLookup.won?.count || 0,
      value: stageLookup.won?.value || 0
    },
    lost: {
      count: stageLookup.lost?.count || 0,
      value: stageLookup.lost?.value || 0
    },
    won_in_range: {
      count: Number(wonInRange?.count || 0),
      value: Number(wonInRange?.value || 0)
    },
    recent_sends: recentSends?.results || [],
    recent_activity: recentActivity?.results || []
  });
}

// ── Templates ────────────────────────────────────────────────
async function listTemplates(env) {
  const { results } = await env.DB.prepare('SELECT id,name,subject,created_at,updated_at FROM templates ORDER BY created_at DESC').all();
  return jres(results);
}
async function seedAdsOptimiserRealEstateTemplates(env) {
  const templates = getAdsOptimiserRealEstateTemplates();
  const created = [];
  const existing = [];
  await env.DB.prepare('DELETE FROM templates WHERE id=?').bind('seed_ads_optimiser_real_estate_video_walkthrough_v1').run();
  for (const template of templates) {
    const row = await env.DB.prepare('SELECT id,name,subject,created_at,updated_at FROM templates WHERE id=? LIMIT 1')
      .bind(template.id).first();
    if (row) {
      if (template.id === 'seed_ao_re_luxury_homes_editorial_v3') {
        const ts = now();
        await env.DB.prepare('UPDATE templates SET name=?,subject=?,html_body=?,updated_at=? WHERE id=?')
          .bind(template.name, template.subject, template.html_body, ts, template.id).run();
        existing.push({ ...row, name: template.name, subject: template.subject, updated_at: ts });
        continue;
      }
      existing.push(row);
      continue;
    }
    const ts = now();
    await env.DB.prepare('INSERT INTO templates (id,name,subject,html_body,created_at,updated_at) VALUES (?,?,?,?,?,?)')
      .bind(template.id, template.name, template.subject, template.html_body, ts, ts).run();
    created.push({
      id: template.id,
      name: template.name,
      subject: template.subject,
      created_at: ts,
      updated_at: ts
    });
  }
  return jres({
    ok: true,
    created_count: created.length,
    existing_count: existing.length,
    templates: [...created, ...existing]
  });
}
async function getTemplate(env, id) {
  const row = await env.DB.prepare('SELECT id,name,subject,html_body,created_at,updated_at FROM templates WHERE id=?').bind(id).first();
  if (!row) return jres({ error: 'Template not found' }, 404);
  return jres(row);
}
async function createTemplate(req, env) {
  const { name, subject, html_body } = await req.json();
  if (!name || !subject || !html_body) return jres({ error: 'name, subject, html_body required' }, 400);
  const id = uid(), ts = now();
  await env.DB.prepare('INSERT INTO templates (id,name,subject,html_body,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id, name, subject, html_body, ts, ts).run();
  return jres({ id, name, subject });
}
async function updateTemplate(req, env, id) {
  const { name, subject, html_body } = await req.json();
  await env.DB.prepare('UPDATE templates SET name=?,subject=?,html_body=?,updated_at=? WHERE id=?').bind(name, subject, html_body, now(), id).run();
  return jres({ ok: true });
}
async function deleteTemplate(env, id) {
  await env.DB.prepare('DELETE FROM templates WHERE id=?').bind(id).run();
  return jres({ ok: true });
}

// ── Contacts ─────────────────────────────────────────────────
async function listContacts(env, url) {
  await ensureContactProfileTable(env);
  const q = url.searchParams.get('q') || '';
  const stage = url.searchParams.get('stage') || '';
  const title = url.searchParams.get('title') || '';
  const search = parseContactSearchQuery(q);
  let sql = `SELECT c.*,
    COALESCE(p.first_name,'') first_name,
    COALESCE(p.last_name,'') last_name,
    COALESCE(p.title,'') title,
    COALESCE(p.image_url,'') image_url,
    COALESCE((SELECT json_group_array(l.name)
      FROM contact_list_members m
      JOIN contact_lists l ON l.id=m.list_id
      WHERE m.contact_id=c.id), '[]') list_names_json,
    COALESCE((SELECT COUNT(*) FROM contact_list_members m WHERE m.contact_id=c.id), 0) list_count
    FROM contacts c
    LEFT JOIN contact_profiles p ON p.contact_id=c.id
    WHERE c.unsubscribed=0`;
  const params = [];
  if (search.text) {
    sql += ' AND (lower(c.email) LIKE ? OR lower(c.name) LIKE ? OR lower(c.company) LIKE ? OR lower(c.phone) LIKE ? OR lower(p.title) LIKE ?)';
    params.push(`%${search.text}%`, `%${search.text}%`, `%${search.text}%`, `%${search.text}%`, `%${search.text}%`);
  }
  for (const tag of search.tags) {
    sql += ` AND EXISTS (
      SELECT 1
      FROM json_each(CASE WHEN c.tags IS NULL OR c.tags='' THEN '[]' ELSE c.tags END) jt
      WHERE lower(jt.value)=?
    )`;
    params.push(tag);
  }
  for (const companyFilter of search.companies) {
    sql += ' AND lower(c.company) LIKE ?';
    params.push(`%${companyFilter}%`);
  }
  for (const titleFilter of search.titles) {
    sql += ' AND lower(p.title) LIKE ?';
    params.push(`%${titleFilter}%`);
  }
  if (title) {
    sql += ' AND p.title = ?';
    params.push(title);
  }
  if (stage) { sql += ' AND c.stage=?'; params.push(stage); }
  sql += ' ORDER BY c.created_at DESC LIMIT 1000';
  const stmt = env.DB.prepare(sql);
  const { results } = await (params.length ? stmt.bind(...params) : stmt).all();
  return jres(results);
}
async function createContact(req, env) {
  await ensureContactProfileTable(env);
  const { email, name, first_name, last_name, title, company, stage, deal_value, tags, phone, linkedin, image_url } = await req.json();
  if (!email) return jres({ error: 'Email required' }, 400);
  const id = uid();
  const fullName = formatContactName(first_name, last_name, name);
  try {
    await env.DB.prepare('INSERT INTO contacts (id,email,name,company,stage,deal_value,tags,phone,linkedin,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, email.toLowerCase().trim(), fullName, company||'', stage||'lead', deal_value||0, JSON.stringify(tags||[]), phone||'', linkedin||'', now()).run();
    await saveContactProfile(env, id, first_name, last_name, title, image_url);
    return jres({ id, email });
  } catch { return jres({ error: 'Email already exists' }, 409); }
}
async function importContacts(req, env) {
  const { csv, batch_tag, extra_tags, list_id, new_list_name } = await req.json();
  if (!csv) return jres({ error: 'csv required' }, 400);
  await ensureContactProfileTable(env);
  let targetListId = '';
  let listName = '';
  const requestedListName = (new_list_name || '').trim();
  if (requestedListName) {
    const existingList = await env.DB.prepare('SELECT id,name FROM contact_lists WHERE lower(name)=lower(?) LIMIT 1').bind(requestedListName).first();
    if (existingList?.id) {
      targetListId = existingList.id;
      listName = existingList.name || requestedListName;
    } else {
      targetListId = uid();
      listName = requestedListName;
      await env.DB.prepare('INSERT INTO contact_lists (id,name,description,created_at) VALUES (?,?,?,?)')
        .bind(targetListId, listName, '', now()).run();
    }
  } else if (list_id) {
    const list = await env.DB.prepare('SELECT id,name FROM contact_lists WHERE id=? LIMIT 1').bind(list_id).first();
    if (!list?.id) return jres({ error: 'Selected list was not found' }, 400);
    targetListId = list.id;
    listName = list.name || '';
  }
  const importTags = uniqueTags(['source:csv', batch_tag, ...(Array.isArray(extra_tags) ? extra_tags : [])]);
  const lines = csv.trim().split('\n');
  const hdr = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/["\r]/g, ''));
  const ei = hdr.indexOf('email');
  const ni = hdr.indexOf('name');
  const fi = hdr.indexOf('first_name');
  const li = hdr.indexOf('last_name');
  const ti = hdr.indexOf('title');
  const ci = hdr.indexOf('company');
  const si = hdr.indexOf('stage');
  const di = hdr.indexOf('deal_value');
  const pi = hdr.indexOf('phone');
  const ii = hdr.indexOf('image_url') >= 0 ? hdr.indexOf('image_url') : hdr.indexOf('image');
  if (ei === -1) return jres({ error: 'CSV must have an "email" column header' }, 400);
  let imported = 0, skipped = 0, linked = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim().replace(/["\r]/g, ''));
    const email = cols[ei]?.toLowerCase().trim();
    if (!email || !email.includes('@')) { skipped++; continue; }
    const firstName = fi >= 0 ? cols[fi] || '' : '';
    const lastName = li >= 0 ? cols[li] || '' : '';
    const title = ti >= 0 ? cols[ti] || '' : '';
    const fullName = formatContactName(firstName, lastName, ni >= 0 ? cols[ni] || '' : '');
    const insertId = uid();
    try {
      const result = await env.DB.prepare('INSERT OR IGNORE INTO contacts (id,email,name,company,stage,deal_value,phone,tags,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(insertId, email, fullName, ci>=0?cols[ci]||'':'', si>=0?cols[si]||'lead':'lead', di>=0?parseFloat(cols[di])||0:0, pi>=0?cols[pi]||'':'', JSON.stringify(importTags), now()).run();
      const row = await env.DB.prepare('SELECT id,tags FROM contacts WHERE email=? LIMIT 1').bind(email).first();
      if (row?.id) await saveContactProfile(env, row.id, firstName, lastName, title, ii >= 0 ? cols[ii] || '' : '');
      if (row?.id) {
        const mergedTags = uniqueTags([...(parseTags(row.tags)), ...importTags]);
        await env.DB.prepare('UPDATE contacts SET tags=? WHERE id=?').bind(JSON.stringify(mergedTags), row.id).run();
        if (targetListId) {
          const membership = await env.DB.prepare('INSERT OR IGNORE INTO contact_list_members (contact_id,list_id) VALUES (?,?)').bind(row.id, targetListId).run();
          if (membership.meta?.changes) linked++;
        }
      }
      if (result.meta?.changes) imported++;
      else skipped++;
    } catch { skipped++; }
  }
  return jres({ imported, skipped, linked, list_name: listName });
}
async function updateContact(req, env, id) {
  await ensureContactProfileTable(env);
  const { name, first_name, last_name, title, company, stage, deal_value, tags, phone, linkedin, follow_up_at, image_url } = await req.json();
  const fullName = formatContactName(first_name, last_name, name);
  const current = await env.DB.prepare('SELECT stage FROM contacts WHERE id=?').bind(id).first();
  const nextStage = stage || 'lead';
  await env.DB.prepare('UPDATE contacts SET name=?,company=?,stage=?,deal_value=?,tags=?,phone=?,linkedin=?,follow_up_at=? WHERE id=?')
    .bind(fullName, company||'', nextStage, deal_value||0, JSON.stringify(tags||[]), phone||'', linkedin||'', follow_up_at||null, id).run();
  await saveContactProfile(env, id, first_name, last_name, title, image_url);
  await logStageChangeActivity(env, id, current?.stage || 'lead', nextStage);
  return jres({ ok: true });
}
async function deleteContact(env, id) {
  await env.DB.prepare('DELETE FROM contact_list_members WHERE contact_id=?').bind(id).run();
  await env.DB.prepare("DELETE FROM activity WHERE entity_type='contact' AND entity_id=?").bind(id).run();
  // Sprint 6: cascade attachments + entity links
  await deleteAttachmentsForEntity(env, 'contact', id);
  await deleteLinksForEntity(env, 'contact', id);
  await ensureContactProfileTable(env);
  await env.DB.prepare('DELETE FROM contact_profiles WHERE contact_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM contacts WHERE id=?').bind(id).run();
  return jres({ ok: true });
}

// ── Lists ────────────────────────────────────────────────────
async function listLists(env) {
  const { results } = await env.DB.prepare('SELECT l.*,(SELECT COUNT(*) FROM contact_list_members m WHERE m.list_id=l.id) cnt FROM contact_lists l ORDER BY l.created_at DESC').all();
  return jres(results);
}
async function createList(req, env) {
  const { name, description } = await req.json();
  if (!name) return jres({ error: 'Name required' }, 400);
  const id = uid();
  await env.DB.prepare('INSERT INTO contact_lists (id,name,description,created_at) VALUES (?,?,?,?)').bind(id, name, description || '', now()).run();
  return jres({ id, name });
}
async function updateList(req, env, id) {
  const { name, description } = await req.json();
  if (!name) return jres({ error: 'Name required' }, 400);
  await env.DB.prepare('UPDATE contact_lists SET name=?,description=? WHERE id=?').bind(name, description || '', id).run();
  return jres({ ok: true });
}
async function deleteList(env, id) {
  await env.DB.prepare('DELETE FROM contact_list_members WHERE list_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM contact_lists WHERE id=?').bind(id).run();
  return jres({ ok: true });
}
async function getListContacts(env, listId) {
  const { results } = await env.DB.prepare('SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=?').bind(listId).all();
  return jres(results);
}
async function addToList(req, env, listId) {
  const { contact_ids } = await req.json();
  for (const cid of (contact_ids || [])) {
    await env.DB.prepare('INSERT OR IGNORE INTO contact_list_members (contact_id,list_id) VALUES (?,?)').bind(cid, listId).run();
  }
  return jres({ ok: true });
}
async function removeFromList(env, listId, contactId) {
  await env.DB.prepare('DELETE FROM contact_list_members WHERE list_id=? AND contact_id=?').bind(listId, contactId).run();
  return jres({ ok: true });
}

// ── Campaigns ────────────────────────────────────────────────
async function listCampaigns(env) {
  const { results } = await env.DB.prepare('SELECT c.*,l.name list_name FROM campaigns c LEFT JOIN contact_lists l ON c.list_id=l.id ORDER BY c.created_at DESC').all();
  for (const c of results) {
    const { results: steps } = await env.DB.prepare('SELECT s.*,t.name tname,t.subject FROM campaign_steps s JOIN templates t ON s.template_id=t.id WHERE s.campaign_id=? ORDER BY s.step_order').bind(c.id).all();
    c.steps = steps;
    c.schedule_config = JSON.parse(c.schedule_config || '{}');
  }
  return jres(results);
}
async function createCampaign(req, env) {
  const { name, list_id, schedule_type, schedule_config, steps, from_email, from_name } = await req.json();
  if (!name || !list_id || !schedule_type || !steps?.length) return jres({ error: 'name, list_id, schedule_type, steps required' }, 400);
  const id = uid(), ts = now();
  await env.DB.prepare('INSERT INTO campaigns (id,name,list_id,schedule_type,schedule_config,status,from_email,from_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, name, list_id, schedule_type, JSON.stringify(schedule_config || {}), 'draft', from_email || DEFAULT_FROM, from_name || DEFAULT_NAME, ts, ts).run();
  for (let i = 0; i < steps.length; i++) {
    await env.DB.prepare('INSERT INTO campaign_steps (id,campaign_id,template_id,step_order,delay_days) VALUES (?,?,?,?,?)').bind(uid(), id, steps[i].template_id, i, steps[i].delay_days || 0).run();
  }
  return jres({ id, name });
}
async function updateCampaign(req, env, id) {
  const { name, list_id, schedule_type, schedule_config, steps, from_email, from_name } = await req.json();
  await env.DB.prepare('UPDATE campaigns SET name=?,list_id=?,schedule_type=?,schedule_config=?,from_email=?,from_name=?,updated_at=? WHERE id=?').bind(name, list_id, schedule_type, JSON.stringify(schedule_config || {}), from_email || DEFAULT_FROM, from_name || DEFAULT_NAME, now(), id).run();
  if (steps) {
    await env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id=?').bind(id).run();
    for (let i = 0; i < steps.length; i++) {
      await env.DB.prepare('INSERT INTO campaign_steps (id,campaign_id,template_id,step_order,delay_days) VALUES (?,?,?,?,?)').bind(uid(), id, steps[i].template_id, i, steps[i].delay_days || 0).run();
    }
  }
  return jres({ ok: true });
}
async function deleteCampaign(env, id) {
  await env.DB.prepare('DELETE FROM campaign_steps WHERE campaign_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM drip_progress WHERE campaign_id=?').bind(id).run();
  await env.DB.prepare('DELETE FROM campaigns WHERE id=?').bind(id).run();
  return jres({ ok: true });
}
async function setCampaignStatus(env, id, status) {
  await env.DB.prepare('UPDATE campaigns SET status=?,updated_at=? WHERE id=?').bind(status, now(), id).run();
  return jres({ ok: true });
}

// ── Send Now ─────────────────────────────────────────────────
async function sendNow(env, id) {
  const campaign = await env.DB.prepare('SELECT * FROM campaigns WHERE id=?').bind(id).first();
  if (!campaign) return jres({ error: 'Campaign not found' }, 404);
  const step = await env.DB.prepare('SELECT s.*,t.subject,t.html_body,t.name tname FROM campaign_steps s JOIN templates t ON s.template_id=t.id WHERE s.campaign_id=? ORDER BY s.step_order LIMIT 1').bind(id).first();
  if (!step) return jres({ error: 'No steps configured' }, 400);
  const { results: contacts } = await env.DB.prepare('SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=?').bind(campaign.list_id).all();
  let sent = 0, failed = 0, skipped = 0;
  for (const contact of contacts) {
    const r = await sendEmail(env, { to: contact.email, subject: step.subject, html_body: merge(step.html_body, contact), from_email: campaign.from_email, from_name: campaign.from_name });
    const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
    await addLog(env, { campaign_id: id, campaign_name: campaign.name, contact_id: contact.id, contact_email: contact.email, template_id: step.template_id, template_name: step.tname, subject: step.subject, status, error: r.error });
    if (r.ok) sent++; else if (r.skipped) skipped++; else failed++;
  }
  await env.DB.prepare('UPDATE campaigns SET status=?,updated_at=? WHERE id=?').bind('completed', now(), id).run();
  return jres({ sent, failed, skipped });
}

// ── Logs ─────────────────────────────────────────────────────
async function getLogs(env, url) {
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '200'), 500);
  const { results } = await env.DB.prepare('SELECT * FROM sent_log ORDER BY sent_at DESC LIMIT ?').bind(limit).all();
  return jres(results);
}
async function getUnsubscribes(env) {
  // Read from the UNSUBSCRIBES KV namespace shared with the email worker.
  // Keys are stored as unsub:{email} — list them all and parse the records.
  if (!env.UNSUBSCRIBES) return jres({ error: 'UNSUBSCRIBES KV binding not configured' }, 500);
  const list = await env.UNSUBSCRIBES.list({ prefix: 'unsub:' });
  const records = [];
  for (const key of list.keys) {
    const raw = await env.UNSUBSCRIBES.get(key.name);
    if (raw) {
      try { records.push(JSON.parse(raw)); } catch { records.push({ email: key.name.replace('unsub:', '') }); }
    }
  }
  records.sort((a, b) => (b.unsubscribedAt || '').localeCompare(a.unsubscribedAt || ''));
  return jres(records);
}

// ── Scheduler ────────────────────────────────────────────────
async function runScheduler(env) {
  const ts = now();
  // One-time scheduled
  const { results: once } = await env.DB.prepare("SELECT * FROM campaigns WHERE schedule_type='once' AND status='active' AND json_extract(schedule_config,'$.send_at')<=?").bind(ts).all();
  for (const c of once) await sendNow(env, c.id);
  // Recurring
  const { results: rec } = await env.DB.prepare("SELECT * FROM campaigns WHERE schedule_type='recurring' AND status='active' AND json_extract(schedule_config,'$.next_run')<=?").bind(ts).all();
  for (const c of rec) {
    await sendNow(env, c.id);
    const cfg = JSON.parse(c.schedule_config || '{}');
    cfg.next_run = new Date(Date.now() + (cfg.interval_days || 7) * 86400000).toISOString();
    await env.DB.prepare('UPDATE campaigns SET schedule_config=?,status=?,updated_at=? WHERE id=?').bind(JSON.stringify(cfg), 'active', now(), c.id).run();
  }
  // Drip
  const { results: drips } = await env.DB.prepare("SELECT * FROM campaigns WHERE schedule_type='drip' AND status='active'").all();
  for (const c of drips) await processDrip(env, c, ts);
}

async function processDrip(env, campaign, ts) {
  // No local unsubscribe filter — email worker handles RECIPIENT_UNSUBSCRIBED automatically
  const { results: contacts } = await env.DB.prepare('SELECT c.* FROM contacts c JOIN contact_list_members m ON c.id=m.contact_id WHERE m.list_id=?').bind(campaign.list_id).all();
  const { results: steps } = await env.DB.prepare('SELECT s.*,t.subject,t.html_body,t.name tname FROM campaign_steps s JOIN templates t ON s.template_id=t.id WHERE s.campaign_id=? ORDER BY s.step_order').bind(campaign.id).all();
  if (!steps.length) return;
  for (const contact of contacts) {
    let prog = await env.DB.prepare('SELECT * FROM drip_progress WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).first();
    if (!prog) {
      await env.DB.prepare('INSERT INTO drip_progress (id,campaign_id,contact_id,current_step,last_sent_at,next_send_at,completed) VALUES (?,?,?,0,?,?,0)').bind(uid(), campaign.id, contact.id, ts, ts).run();
      prog = { current_step: 0, next_send_at: ts, completed: 0 };
    }
    if (prog.completed || prog.next_send_at > ts) continue;
    const step = steps[prog.current_step];
    if (!step) { await env.DB.prepare('UPDATE drip_progress SET completed=1 WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).run(); continue; }
    const r = await sendEmail(env, { to: contact.email, subject: step.subject, html_body: merge(step.html_body, contact), from_email: campaign.from_email, from_name: campaign.from_name });
    const status = r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed';
    await addLog(env, { campaign_id: campaign.id, campaign_name: campaign.name, contact_id: contact.id, contact_email: contact.email, template_id: step.template_id, template_name: step.tname, subject: step.subject, status, error: r.error });
    // If skipped (unsubscribed), mark drip sequence as completed for this contact
    if (r.skipped) {
      await env.DB.prepare('UPDATE drip_progress SET completed=1 WHERE campaign_id=? AND contact_id=?').bind(campaign.id, contact.id).run();
      continue;
    }
    const nextIdx = prog.current_step + 1;
    const nextStep = steps[nextIdx];
    const nextSend = nextStep ? new Date(Date.now() + (nextStep.delay_days || 1) * 86400000).toISOString() : null;
    await env.DB.prepare('UPDATE drip_progress SET current_step=?,last_sent_at=?,next_send_at=?,completed=? WHERE campaign_id=? AND contact_id=?').bind(nextIdx, ts, nextSend, nextStep ? 0 : 1, campaign.id, contact.id).run();
  }
}

// ── Email + Utils ─────────────────────────────────────────────
async function sendEmail(env, { to, subject, html_body, from_email, from_name }) {
  const apiUrl = String(env.EMAIL_API_URL || env.EMAIL_WORKER_URL || EMAIL_WORKER).trim();
  const clientId = String(env.CF_ACCESS_CLIENT_ID || '').trim();
  const clientSecret = String(env.CF_ACCESS_CLIENT_SECRET || '').trim();
  if (!apiUrl) return { ok: false, skipped: false, error: 'Email API URL is not configured.' };
  if (!clientId || !clientSecret) {
    return { ok: false, skipped: false, error: 'Cloudflare Access service token is not configured.' };
  }
  const delays = [1500, 4000, 9000];
  let lastError = 'Email send failed';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const r = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Access-Client-Id': clientId,
          'CF-Access-Client-Secret': clientSecret
        },
        body: JSON.stringify({ to, subject, message: html_body, contentType: 'HTML', fromEmail: from_email, fromName: from_name })
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 403 && d.code === 'RECIPIENT_UNSUBSCRIBED') {
        return { ok: false, skipped: true, error: 'Unsubscribed' };
      }
      if (r.ok && d.success !== false) {
        return { ok: true, skipped: false, error: null };
      }
      lastError = d.error || d.message || `Email API returned HTTP ${r.status}`;
      if (!shouldRetryEmailSend(r.status, d) || attempt === delays.length) {
        return { ok: false, skipped: false, error: lastError };
      }
      await sleep(getRetryDelayMs(r, attempt, delays));
    } catch (e) {
      lastError = e?.message || 'Network error';
      if (attempt === delays.length) {
        return { ok: false, skipped: false, error: lastError };
      }
      await sleep(delays[attempt]);
    }
  }
  return { ok: false, skipped: false, error: lastError };
}
function shouldRetryEmailSend(status, body) {
  if (status === 429 || status >= 500) return true;
  const combined = [body?.code, body?.error, body?.message, body?.details].map(value => String(value || '')).join(' ').toLowerCase();
  if (status === 400 && body?.code === 'MS_GRAPH_SEND_ERROR') {
    return /429|thrott|too many requests|temporar|timeout|try again|server busy|service unavailable/.test(combined);
  }
  return false;
}
function getRetryDelayMs(response, attempt, defaults) {
  const retryAfter = response.headers.get('Retry-After');
  const fallback = defaults[Math.min(attempt, defaults.length - 1)];
  if (!retryAfter) return fallback;
  const seconds = parseInt(retryAfter, 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(fallback, seconds * 1000);
  const retryAt = Date.parse(retryAfter);
  if (Number.isFinite(retryAt)) return Math.max(fallback, Math.max(0, retryAt - Date.now()));
  return fallback;
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
async function addLog(env, d) {
  await env.DB.prepare('INSERT INTO sent_log (id,campaign_id,campaign_name,contact_id,contact_email,template_id,template_name,subject,status,error,sent_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(uid(), d.campaign_id, d.campaign_name, d.contact_id, d.contact_email, d.template_id, d.template_name, d.subject, d.status, d.error || null, now()).run();
  // Keep last_contacted_at fresh on every successful send
  if (d.status === 'sent' && d.contact_id) {
    await env.DB.prepare('UPDATE contacts SET last_contacted_at=? WHERE id=?').bind(now(), d.contact_id).run();
  }
}
function merge(html, c) {
  // {{name}}, {{first_name}}, {{last_name}}, {{email}}, {{company}} are resolved here.
  // {{unsubscribe_url}} and {{physical_address}} are resolved by the email worker
  // automatically via MAIL_UNSUBSCRIBE_BASE_URL + MAIL_PHYSICAL_ADDRESS env vars.
  const firstName = String(c.first_name || splitContactName(c.name).first_name || '').trim();
  const lastName = String(c.last_name || splitContactName(c.name).last_name || '').trim();
  return html
    .replace(/\{\{first_name\}\}/gi, firstName || 'there')
    .replace(/\{\{last_name\}\}/gi, lastName)
    .replace(/\{\{name\}\}/gi, c.name || 'there')
    .replace(/\{\{email\}\}/gi, c.email)
    .replace(/\{\{company\}\}/gi, c.company || '');
}
function splitContactName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first_name: '', last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}
function uid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function jres(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }); }
function addCors(res) {
  const h = new Headers(res.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  return new Response(res.body, { status: res.status, headers: h });
}

// ── CRM Backend ───────────────────────────────────────────────
const STAGES = ['lead','prospect','qualified','proposal','won','lost'];

function formatStageActivityValue(stage) {
  const value = String(stage || 'lead').trim().toLowerCase();
  return STAGES.includes(value) ? value[0].toUpperCase() + value.slice(1) : 'Lead';
}

async function logStageChangeActivity(env, contactId, fromStage, toStage) {
  if (!contactId) return;
  const previous = String(fromStage || 'lead').trim().toLowerCase();
  const next = String(toStage || 'lead').trim().toLowerCase();
  if (previous === next) return;
  const id = uid();
  const content = `${formatStageActivityValue(previous)} -> ${formatStageActivityValue(next)}`;
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, 'contact', ?, NULL, 'stage', ?, ?)`
  ).bind(id, contactId, content, now()).run();
  await env.DB.prepare('UPDATE contacts SET notes_count=notes_count+1 WHERE id=?').bind(contactId).run();

  // Fire emit() for the stage change so Sprint 5 Discord rules can route it.
  try {
    const contact = await env.DB.prepare('SELECT id, name, email FROM contacts WHERE id=?').bind(contactId).first();
    if (contact) {
      await emit(env, EVENT_TYPES.CONTACT_STAGE_CHANGED, {
        contact, old_stage: previous, new_stage: next,
      });
    }
  } catch {}
}

async function getCrmPipeline(env) {
  const { results } = await env.DB.prepare(
    'SELECT * FROM contacts WHERE unsubscribed=0 ORDER BY last_contacted_at DESC NULLS LAST, created_at DESC'
  ).all();
  const pipeline = {};
  for (const s of STAGES) pipeline[s] = [];
  for (const c of results) {
    const s = STAGES.includes(c.stage) ? c.stage : 'lead';
    try { c.tags = JSON.parse(c.tags || '[]'); } catch { c.tags = []; }
    pipeline[s].push(c);
  }
  return jres(pipeline);
}

async function getCrmStats(env) {
  const { results } = await env.DB.prepare(
    'SELECT stage, COUNT(*) cnt, COALESCE(SUM(deal_value),0) value FROM contacts WHERE unsubscribed=0 GROUP BY stage'
  ).all();
  const stats = {};
  for (const s of STAGES) stats[s] = { count: 0, value: 0 };
  for (const r of results) { if (stats[r.stage]) { stats[r.stage].count = r.cnt; stats[r.stage].value = r.value; } }
  const today = new Date().toISOString().split('T')[0];
  const fu = await env.DB.prepare('SELECT COUNT(*) n FROM contacts WHERE unsubscribed=0 AND follow_up_at<=? AND stage NOT IN ("won","lost")').bind(today+'T23:59:59Z').first();
  return jres({ stages: stats, followups_due: fu.n });
}

async function getFollowUps(env) {
  const today = new Date().toISOString().split('T')[0];
  const { results } = await env.DB.prepare(
    'SELECT * FROM contacts WHERE unsubscribed=0 AND follow_up_at<=? AND stage NOT IN ("won","lost") ORDER BY follow_up_at ASC'
  ).bind(today+'T23:59:59Z').all();
  for (const c of results) { try { c.tags = JSON.parse(c.tags||'[]'); } catch { c.tags = []; } }
  return jres(results);
}

async function getContactDetail(env, id) {
  await ensureContactProfileTable(env);
  const contact = await env.DB.prepare(`SELECT c.*,
      COALESCE(p.first_name,'') first_name,
      COALESCE(p.last_name,'') last_name,
      COALESCE(p.title,'') title,
      COALESCE(p.image_url,'') image_url
    FROM contacts c
    LEFT JOIN contact_profiles p ON p.contact_id=c.id
    WHERE c.id=?`).bind(id).first();
  if (!contact) return jres({ error: 'Not found' }, 404);
  try { contact.tags = JSON.parse(contact.tags||'[]'); } catch { contact.tags = []; }
  const { results: notesRaw } = await env.DB.prepare(
    `SELECT id, entity_id, body_md, kind, created_at
     FROM activity
     WHERE entity_type='contact' AND entity_id=?
     ORDER BY created_at DESC`
  ).bind(id).all();
  const notes = (notesRaw || []).map(reshapeActivityAsNote);
  const { results: emails } = await env.DB.prepare('SELECT * FROM sent_log WHERE contact_id=? ORDER BY sent_at DESC LIMIT 50').bind(id).all();
  const { results: lists } = await env.DB.prepare('SELECT l.name FROM contact_lists l JOIN contact_list_members m ON l.id=m.list_id WHERE m.contact_id=?').bind(id).all();
  return jres({ contact, notes, emails, lists: lists.map(l=>l.name) });
}

async function ensureContactProfileTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS contact_profiles (
    contact_id TEXT PRIMARY KEY,
    first_name TEXT DEFAULT '',
    last_name TEXT DEFAULT '',
    title TEXT DEFAULT '',
    image_url TEXT DEFAULT '',
    updated_at TEXT NOT NULL
  )`).run();
  try {
    await env.DB.prepare(`ALTER TABLE contact_profiles ADD COLUMN title TEXT DEFAULT ''`).run();
  } catch (err) {
    const message = String(err?.message || err || '');
    if (!message.includes('duplicate column name')) throw err;
  }
}

function formatContactName(firstName, lastName, fallbackName) {
  const fullName = [String(firstName || '').trim(), String(lastName || '').trim()].filter(Boolean).join(' ').trim();
  return fullName || String(fallbackName || '').trim();
}

function parseContactSearchQuery(rawQuery) {
  const source = String(rawQuery || '');
  const tags = [];
  const companies = [];
  const titles = [];
  const tokenRegex = /\b(tag|company|title):("([^"]+)"|[^\s]+)/gi;
  let plainText = source.replace(tokenRegex, (_, key, rawValue, quotedValue) => {
    const value = String(quotedValue || rawValue || '').replace(/^"|"$/g, '').trim().toLowerCase();
    if (!value) return ' ';
    if (key.toLowerCase() === 'tag') tags.push(value);
    else if (key.toLowerCase() === 'company') companies.push(value);
    else if (key.toLowerCase() === 'title') titles.push(value);
    return ' ';
  });
  plainText = plainText.replace(/\s+/g, ' ').trim().toLowerCase();
  return {
    text: plainText,
    tags: uniqueTags(tags),
    companies: uniqueTags(companies),
    titles: uniqueTags(titles)
  };
}

function parseTags(rawTags) {
  if (Array.isArray(rawTags)) return rawTags.map(tag => String(tag || '').trim()).filter(Boolean);
  try { return JSON.parse(rawTags || '[]').map(tag => String(tag || '').trim()).filter(Boolean); } catch { return []; }
}

function uniqueTags(values) {
  return Array.from(new Set((values || []).map(tag => String(tag || '').trim()).filter(Boolean)));
}

async function saveContactProfile(env, contactId, firstName, lastName, title, imageUrl) {
  const ts = now();
  await env.DB.prepare(`INSERT INTO contact_profiles (contact_id,first_name,last_name,title,image_url,updated_at)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(contact_id) DO UPDATE SET
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      title=excluded.title,
      image_url=excluded.image_url,
      updated_at=excluded.updated_at`)
    .bind(contactId, firstName || '', lastName || '', title || '', imageUrl || '', ts).run();
}

async function patchContact(req, env, id) {
  const body = await req.json();
  const fields = [];
  const vals = [];
  const allowed = ['name','company','stage','deal_value','tags','phone','linkedin','follow_up_at'];
  const current = 'stage' in body
    ? await env.DB.prepare('SELECT stage FROM contacts WHERE id=?').bind(id).first()
    : null;
  for (const k of allowed) {
    if (k in body) {
      fields.push(`${k}=?`);
      vals.push(k === 'tags' ? JSON.stringify(body[k]||[]) : body[k]);
    }
  }
  if (!fields.length) return jres({ error: 'No fields to update' }, 400);
  vals.push(id);
  await env.DB.prepare(`UPDATE contacts SET ${fields.join(',')} WHERE id=?`).bind(...vals).run();
  if ('stage' in body) await logStageChangeActivity(env, id, current?.stage || 'lead', body.stage || 'lead');
  return jres({ ok: true });
}

// Sprint 5: contact notes now live in the polymorphic `activity` table.
// Reshape rows to the legacy {id, contact_id, content, type, created_at}
// shape so the existing frontend keeps working without changes.
function reshapeActivityAsNote(r) {
  return {
    id: r.id,
    contact_id: r.entity_id,
    content: r.body_md,
    type: r.kind,
    created_at: r.created_at,
  };
}

async function getNotes(env, contactId) {
  const { results } = await env.DB.prepare(
    `SELECT id, entity_id, body_md, kind, created_at
     FROM activity
     WHERE entity_type='contact' AND entity_id=?
     ORDER BY created_at DESC`
  ).bind(contactId).all();
  return jres((results || []).map(reshapeActivityAsNote));
}

async function addNote(req, env, contactId) {
  const { content, type } = await req.json();
  if (!content) return jres({ error: 'content required' }, 400);
  const id = uid();
  const ts = now();
  const kind = type || 'note';
  await env.DB.prepare(
    `INSERT INTO activity (id, entity_type, entity_id, user_id, kind, body_md, created_at)
     VALUES (?, 'contact', ?, NULL, ?, ?, ?)`
  ).bind(id, contactId, kind, content, ts).run();
  await env.DB.prepare('UPDATE contacts SET notes_count=notes_count+1 WHERE id=?').bind(contactId).run();
  return jres({ id, content, type: kind, created_at: ts });
}

async function deleteNote(env, noteId) {
  const note = await env.DB.prepare(
    "SELECT entity_id FROM activity WHERE id=? AND entity_type='contact'"
  ).bind(noteId).first();
  await env.DB.prepare("DELETE FROM activity WHERE id=? AND entity_type='contact'").bind(noteId).run();
  if (note) await env.DB.prepare('UPDATE contacts SET notes_count=MAX(0,notes_count-1) WHERE id=?').bind(note.entity_id).run();
  return jres({ ok: true });
}

// ── Dashboard HTML (inline) ───────────────────────────────────
// Dashboard frontend moved to public/index.html, public/dashboard.css, and public/app.js.
