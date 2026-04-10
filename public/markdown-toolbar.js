// ============================================================
// Totally Wild AI — Markdown Toolbar (Sprint 7)
// Small button row that attaches above a <textarea>. Gives
// users the common markdown affordances (bold, italic, lists,
// link, image, codeblock, etc.) without having to remember
// syntax. Loaded as a regular <script> after app.js; uses the
// global esc() helper from app.js at call time.
//
// Public globals:
//   attachMarkdownToolbar(textareaEl, options?)
//   applyMarkdownAction(textareaEl, action)
// ============================================================

// ── Icon constants ──────────────────────────────────────────
// Small inline SVGs at ~14x14 using currentColor so they pick
// up the button text color automatically. Keep paths simple.
const MD_ICON_HEADING = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3 V13 M13 3 V13 M3 8 H13"/></svg>';
const MD_ICON_UL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="3" cy="4" r="1"/><circle cx="3" cy="8" r="1"/><circle cx="3" cy="12" r="1"/><path d="M6 4 H14 M6 8 H14 M6 12 H14"/></svg>';
const MD_ICON_OL = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><text x="1" y="6" font-size="5" font-family="sans-serif" fill="currentColor" stroke="none">1.</text><text x="1" y="11" font-size="5" font-family="sans-serif" fill="currentColor" stroke="none">2.</text><path d="M7 4 H14 M7 9 H14 M7 13 H14"/></svg>';
const MD_ICON_CHECK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1"/><path d="M3 4.5 L4 5.5 L6 3.5"/><path d="M9 4 H14 M9 12 H14"/><rect x="2" y="9" width="5" height="5" rx="1"/></svg>';
const MD_ICON_CODE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 5 L3 8 L6 11 M10 5 L13 8 L10 11"/></svg>';
const MD_ICON_CODEBLOCK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 7 L4 9 L6 11 M10 7 L12 9 L10 11"/></svg>';
const MD_ICON_QUOTE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4 V12 M6 6 H13 M6 10 H11"/></svg>';
const MD_ICON_LINK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9 A3 3 0 0 1 7 5 L9 3 A3 3 0 0 1 13 7 L12 8"/><path d="M9 7 A3 3 0 0 1 9 11 L7 13 A3 3 0 0 1 3 9 L4 8"/></svg>';
const MD_ICON_IMAGE = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="7" r="1.2"/><path d="M3 12 L7 8 L10 11 L12 9 L13 10"/></svg>';

const TOOLBAR_BUTTONS = [
  { id: 'bold',      title: 'Bold (Ctrl+B)',       label: '<strong>B</strong>' },
  { id: 'italic',    title: 'Italic (Ctrl+I)',     label: '<em>I</em>' },
  { id: 'strike',    title: 'Strikethrough',       label: '<s>S</s>' },
  { id: 'heading',   title: 'Heading',             label: MD_ICON_HEADING },
  { id: 'ul',        title: 'Bulleted list',       label: MD_ICON_UL },
  { id: 'ol',        title: 'Numbered list',       label: MD_ICON_OL },
  { id: 'check',     title: 'Task list',           label: MD_ICON_CHECK },
  { id: 'code',      title: 'Inline code',         label: MD_ICON_CODE },
  { id: 'codeblock', title: 'Code block',          label: MD_ICON_CODEBLOCK },
  { id: 'quote',     title: 'Quote',               label: MD_ICON_QUOTE },
  { id: 'link',      title: 'Link',                label: MD_ICON_LINK },
  { id: 'image',     title: 'Image',               label: MD_ICON_IMAGE }
];

// Groups with dividers for visual rhythm.
const TOOLBAR_DIVIDER_AFTER = { strike: true, check: true, quote: true };

// ── Public: attach ──────────────────────────────────────────
function attachMarkdownToolbar(textareaEl, options) {
  if (!textareaEl || textareaEl.tagName !== 'TEXTAREA') return;
  if (textareaEl.dataset.mdToolbarAttached === '1') return;
  textareaEl.dataset.mdToolbarAttached = '1';

  const opts = options || {};
  let buttons = TOOLBAR_BUTTONS;
  if (Array.isArray(opts.buttons) && opts.buttons.length) {
    const allowed = new Set(opts.buttons);
    buttons = TOOLBAR_BUTTONS.filter(b => allowed.has(b.id));
  } else if (opts.compact) {
    const keep = new Set(['bold','italic','heading','ul','ol','check','code','link']);
    buttons = TOOLBAR_BUTTONS.filter(b => keep.has(b.id));
  }

  const bar = document.createElement('div');
  bar.className = 'md-toolbar';

  buttons.forEach(btn => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'md-toolbar-btn';
    el.title = btn.title;
    el.setAttribute('aria-label', btn.title);
    el.dataset.mdAction = btn.id;
    el.innerHTML = btn.label;
    el.addEventListener('mousedown', (ev) => {
      // mousedown + preventDefault so the textarea keeps focus/selection.
      ev.preventDefault();
    });
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      applyMarkdownAction(textareaEl, btn.id, el);
    });
    bar.appendChild(el);

    if (TOOLBAR_DIVIDER_AFTER[btn.id]) {
      const sep = document.createElement('span');
      sep.className = 'md-toolbar-divider';
      sep.setAttribute('aria-hidden', 'true');
      bar.appendChild(sep);
    }
  });

  // Insert before the textarea so it renders above it visually.
  if (textareaEl.parentNode) {
    textareaEl.parentNode.insertBefore(bar, textareaEl);
  }
}
window.attachMarkdownToolbar = attachMarkdownToolbar;

// ── Text manipulation helpers ───────────────────────────────
function getCurrentLineRange(textarea) {
  const value = textarea.value || '';
  const start = textarea.selectionStart || 0;
  const end = textarea.selectionEnd || 0;
  let lineStart = value.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;
  return { start: lineStart, end: lineEnd };
}

function wrapSelection(textarea, before, after, placeholder) {
  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const selected = value.slice(ss, se);
  let insert;
  let cursorStart;
  let cursorEnd;
  if (selected.length) {
    insert = before + selected + after;
    cursorStart = ss + before.length;
    cursorEnd = cursorStart + selected.length;
  } else {
    insert = before + placeholder + after;
    cursorStart = ss + before.length;
    cursorEnd = cursorStart + placeholder.length;
  }
  textarea.value = value.slice(0, ss) + insert + value.slice(se);
  try { textarea.setSelectionRange(cursorStart, cursorEnd); } catch (e) { /* ignore */ }
  fireInput(textarea);
}

function prefixLines(textarea, prefixOrFn) {
  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const range = getCurrentLineRange(textarea);
  // Expand to cover all lines inside the selection.
  const lineStart = Math.min(ss, range.start);
  let lineEnd = range.end;
  if (se > range.end) {
    let e = value.indexOf('\n', se);
    if (e === -1) e = value.length;
    lineEnd = e;
  }
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const newLines = lines.map((line, idx) => {
    const prefix = typeof prefixOrFn === 'function' ? prefixOrFn(line, idx) : prefixOrFn;
    return prefix + line;
  });
  const rebuilt = newLines.join('\n');
  textarea.value = value.slice(0, lineStart) + rebuilt + value.slice(lineEnd);
  const newEnd = lineStart + rebuilt.length;
  try { textarea.setSelectionRange(lineStart, newEnd); } catch (e) { /* ignore */ }
  fireInput(textarea);
}

function fireInput(textarea) {
  try { textarea.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
  try { textarea.focus(); } catch (e) { /* ignore */ }
}

// ── Public: apply action ────────────────────────────────────
function applyMarkdownAction(textarea, action, anchorEl) {
  if (!textarea) return;
  try { textarea.focus(); } catch (e) { /* ignore */ }
  switch (action) {
    case 'bold':
      wrapSelection(textarea, '**', '**', 'bold text');
      return;
    case 'italic':
      wrapSelection(textarea, '*', '*', 'italic');
      return;
    case 'strike':
      wrapSelection(textarea, '~~', '~~', 'strikethrough');
      return;
    case 'heading': {
      const value = textarea.value || '';
      const range = getCurrentLineRange(textarea);
      const line = value.slice(range.start, range.end);
      // Upgrade existing heading: # → ##, ## → ###, ### → (plain)
      let newLine;
      const m = line.match(/^(#{1,6})\s+/);
      if (m) {
        const level = m[1].length;
        if (level >= 3) {
          newLine = line.slice(m[0].length);
        } else {
          newLine = '#'.repeat(level + 1) + ' ' + line.slice(m[0].length);
        }
      } else {
        newLine = '## ' + line;
      }
      textarea.value = value.slice(0, range.start) + newLine + value.slice(range.end);
      const pos = range.start + newLine.length;
      try { textarea.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
      fireInput(textarea);
      return;
    }
    case 'ul':
      prefixLines(textarea, '- ');
      return;
    case 'ol':
      prefixLines(textarea, (_line, idx) => (idx + 1) + '. ');
      return;
    case 'check':
      prefixLines(textarea, '- [ ] ');
      return;
    case 'code':
      wrapSelection(textarea, '`', '`', 'code');
      return;
    case 'codeblock': {
      const value = textarea.value || '';
      const ss = textarea.selectionStart || 0;
      const se = textarea.selectionEnd || 0;
      const selected = value.slice(ss, se) || 'code here';
      // Ensure fences are on their own lines.
      const leading = (ss > 0 && value.charAt(ss - 1) !== '\n') ? '\n' : '';
      const trailing = (se < value.length && value.charAt(se) !== '\n') ? '\n' : '';
      const insert = leading + '```\n' + selected + '\n```' + trailing;
      textarea.value = value.slice(0, ss) + insert + value.slice(se);
      const innerStart = ss + leading.length + 4; // after "```\n"
      const innerEnd = innerStart + selected.length;
      try { textarea.setSelectionRange(innerStart, innerEnd); } catch (e) { /* ignore */ }
      fireInput(textarea);
      return;
    }
    case 'quote':
      prefixLines(textarea, '> ');
      return;
    case 'link':
      openMdLinkPopup(textarea, anchorEl, false);
      return;
    case 'image':
      openMdLinkPopup(textarea, anchorEl, true);
      return;
    default:
      return;
  }
}
window.applyMarkdownAction = applyMarkdownAction;

// ── Link / image popup ──────────────────────────────────────
let __mdLinkPopupEl = null;
let __mdLinkOutsideHandler = null;
let __mdLinkKeyHandler = null;

function closeMdLinkPopup() {
  if (__mdLinkPopupEl && __mdLinkPopupEl.parentNode) {
    __mdLinkPopupEl.parentNode.removeChild(__mdLinkPopupEl);
  }
  __mdLinkPopupEl = null;
  if (__mdLinkOutsideHandler) {
    document.removeEventListener('mousedown', __mdLinkOutsideHandler, true);
    __mdLinkOutsideHandler = null;
  }
  if (__mdLinkKeyHandler) {
    document.removeEventListener('keydown', __mdLinkKeyHandler, true);
    __mdLinkKeyHandler = null;
  }
}

function openMdLinkPopup(textarea, anchorEl, isImage) {
  closeMdLinkPopup();

  const value = textarea.value || '';
  const ss = textarea.selectionStart || 0;
  const se = textarea.selectionEnd || 0;
  const selected = value.slice(ss, se);

  const popup = document.createElement('div');
  popup.className = 'md-link-popup';
  popup.innerHTML = `
    <label>${isImage ? 'Alt text' : 'Text'}
      <input type="text" class="md-link-text" value="" />
    </label>
    <label>URL
      <input type="text" class="md-link-url" placeholder="https://" value="" />
    </label>
    <div class="actions">
      <button type="button" class="btn btn-ghost btn-sm md-link-cancel">Cancel</button>
      <button type="button" class="btn btn-primary btn-sm md-link-insert">Insert</button>
    </div>
  `;

  // Anchor near the toolbar button (or the textarea as a fallback).
  const anchor = anchorEl || textarea;
  const r = anchor.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.top = (r.bottom + 6) + 'px';
  popup.style.left = Math.max(8, Math.min(window.innerWidth - 280, r.left)) + 'px';

  document.body.appendChild(popup);
  __mdLinkPopupEl = popup;

  const textInput = popup.querySelector('.md-link-text');
  const urlInput = popup.querySelector('.md-link-url');
  if (textInput) textInput.value = selected || '';
  try { (selected ? urlInput : textInput).focus(); } catch (e) { /* ignore */ }

  const doInsert = () => {
    const text = (textInput && textInput.value) || (isImage ? 'image' : 'link');
    const url = (urlInput && urlInput.value) || '';
    const md = isImage ? `![${text}](${url})` : `[${text}](${url})`;
    const v = textarea.value || '';
    textarea.value = v.slice(0, ss) + md + v.slice(se);
    const pos = ss + md.length;
    try { textarea.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
    closeMdLinkPopup();
    fireInput(textarea);
  };

  popup.querySelector('.md-link-insert').addEventListener('click', (ev) => {
    ev.preventDefault();
    doInsert();
  });
  popup.querySelector('.md-link-cancel').addEventListener('click', (ev) => {
    ev.preventDefault();
    closeMdLinkPopup();
  });
  [textInput, urlInput].forEach(inp => {
    if (!inp) return;
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        doInsert();
      }
    });
  });

  __mdLinkOutsideHandler = function (ev) {
    if (!__mdLinkPopupEl) return;
    if (__mdLinkPopupEl.contains(ev.target)) return;
    closeMdLinkPopup();
  };
  __mdLinkKeyHandler = function (ev) {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      closeMdLinkPopup();
      try { textarea.focus(); } catch (e) { /* ignore */ }
    }
  };
  // Defer so the click that opened the popup doesn't immediately close it.
  setTimeout(() => {
    document.addEventListener('mousedown', __mdLinkOutsideHandler, true);
    document.addEventListener('keydown', __mdLinkKeyHandler, true);
  }, 0);
}
window.closeMdLinkPopup = closeMdLinkPopup;
