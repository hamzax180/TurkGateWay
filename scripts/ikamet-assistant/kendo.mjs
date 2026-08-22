/**
 * Kendo UI widgets, as e-İkamet actually builds its form.
 *
 * The portal has no <select> elements at all. Every dropdown is a Kendo
 * DropDownList mounted on an `<input type="text">` that Kendo then sets to
 * `display:none`, painting its own `.k-widget` wrapper over the top. The phone
 * box is a Kendo MaskedTextBox. So the controls a person sees and the elements
 * the filler walks are not the same objects, and three mandatory dropdowns
 * came back on "Please select..." — skipped by the visibility gate, and for
 * the same reason never even listed as still-empty. Invisible in both senses.
 *
 * This module is the translation layer: it recognises those widgets, reports
 * what a person would see, and writes through the widget's own API so Kendo's
 * MVVM view model — which is what the form actually submits — is updated too.
 * Setting `el.value` directly leaves the raw input holding a value the model
 * never learned about, which looks filled on screen and submits empty.
 *
 * It is deliberately İkamet-specific and lives here rather than in the shared
 * engine: the visa portal is plain HTML and must not grow a dependency on a
 * widget kit it does not use.
 */

import { fold } from './documents.mjs';

/**
 * Widget roles this module knows how to fill, mapped to the jQuery data key
 * Kendo stores the instance under.
 *
 * A role that is not on this list is left alone entirely rather than
 * approximated with a raw value write — an unknown widget is precisely the
 * case where writing the underlying input silently desynchronises it from
 * what the applicant sees.
 */
const FILLABLE_ROLES = {
  dropdownlist: 'kendoDropDownList',
  combobox: 'kendoComboBox',
  autocomplete: 'kendoAutoComplete',
  maskedtextbox: 'kendoMaskedTextBox',
  numerictextbox: 'kendoNumericTextBox',
  datepicker: 'kendoDatePicker',
  datetimepicker: 'kendoDateTimePicker',
};

/**
 * Widget roles this module refuses to touch, whatever else is true.
 *
 * These are the Kendo equivalents of the engine's never-operate list. A Kendo
 * Button is still İleri; a Kendo CheckBox is still the beyan declaration.
 * Naming them here means a future addition to FILLABLE_ROLES cannot
 * accidentally reach one.
 */
const NEVER_ROLES = ['button', 'checkbox', 'radio', 'switch', 'upload', 'filebrowser'];

/** How many options to carry back to Node from a dropdown's data source. */
const MAX_OPTIONS = 400;

/**
 * Read everything about a field that the caller needs in order to decide
 * whether it can fill it, and with what.
 *
 * Returns null for anything that is not a Kendo widget, which is the signal
 * for "not mine — handle it the ordinary way".
 */
export async function describe(el) {
  return el
    .evaluate(
      (node, config) => {
        const { fillable, never, maxOptions } = config;
        const $ = window.jQuery || window.$;

        const role = (node.getAttribute('data-role') || '').toLowerCase();
        if (never.includes(role)) return { owns: false, refused: true, role };

        const dataKey = fillable[role];
        if (!dataKey || !$ || !$.fn) return null;

        const widget = $(node).data(dataKey);
        if (!widget) return null;

        // What a person actually sees. Kendo hides the original input and
        // renders a wrapper next to it; the wrapper is the control on screen,
        // so its geometry is the one that decides whether this field is real.
        const wrapperNode =
          (widget.wrapper && widget.wrapper[0]) ||
          (node.parentElement && node.parentElement.classList.contains('k-widget')
            ? node.parentElement
            : node.closest('.k-widget')) ||
          node;
        const rect = wrapperNode.getBoundingClientRect();
        const style = getComputedStyle(wrapperNode);
        const visible =
          rect.width >= 2 &&
          rect.height >= 2 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0';

        const base = {
          owns: true,
          role,
          visible,
          disabled: Boolean(node.disabled || node.hasAttribute('disabled')),
          // True when the element the filler walks is hidden but the control
          // is on screen. The engine uses this to override its visibility
          // gate, which was written for plain HTML forms.
          standsIn: visible && getComputedStyle(node).display === 'none',
          focused: document.activeElement === node || wrapperNode.contains(document.activeElement),
        };

        if (role === 'maskedtextbox') {
          const text = String(widget.value() ?? '');
          return {
            ...base,
            kind: 'masked',
            mask: String((widget.options && widget.options.mask) || ''),
            // The raw value with the mask's own literals and placeholders
            // removed — an empty box reads as "(___) ___-__-__", which is not
            // a value however full the input looks.
            value: text.replace(/[_\s]/g, '').replace(/[^0-9a-zA-Z]/g, ''),
            text,
          };
        }

        if (role === 'numerictextbox' || role === 'datepicker' || role === 'datetimepicker') {
          const v = widget.value();
          return {
            ...base,
            kind: role === 'numerictextbox' ? 'numeric' : 'date',
            value:
              v === null || v === undefined ? '' : String(v instanceof Date ? v.toISOString() : v),
            text: String((widget.element && widget.element.val && widget.element.val()) || ''),
          };
        }

        // ── list widgets ──────────────────────────────────────────────────
        const source = widget.dataSource;
        const textField = String((widget.options && widget.options.dataTextField) || 'text');
        const valueField = String((widget.options && widget.options.dataValueField) || 'value');
        const loaded = source && typeof source.data === 'function' ? source.data() : [];
        const total = source && typeof source.total === 'function' ? source.total() : loaded.length;

        const items = [];
        for (let i = 0; i < loaded.length && i < maxOptions; i += 1) {
          const item = loaded[i];
          const text = item[textField];
          const value = item[valueField];
          if (text === undefined || text === null) continue;
          items.push({
            text: String(text),
            value: value === undefined || value === null ? '' : String(value),
          });
        }

        const optionLabel = String((widget.options && widget.options.optionLabel) || '');
        const currentText = typeof widget.text === 'function' ? String(widget.text() ?? '') : '';
        const rawValue =
          widget.value() === undefined || widget.value() === null ? '' : String(widget.value());

        return {
          ...base,
          kind: 'list',
          textField,
          valueField,
          items,
          total: Number(total) || items.length,
          // Whether `items` is the whole list. A server-paged source hands
          // over one page at a time — 38 of 200 countries — so an unmatched
          // value means "not on this page", never "not offered".
          complete: items.length >= (Number(total) || items.length),
          serverFiltering: Boolean(
            source && source.options && (source.options.serverFiltering || source.options.serverPaging),
          ),
          optionLabel,
          text: currentText,
          // The placeholder row is not an answer. Kendo reports the option
          // label as the widget's text while nothing is chosen, and on this
          // form the correct answer to the province question has the value 0
          // — so a value test alone would read a real choice as "still empty"
          // and an unanswered question as filled.
          value: optionLabel && currentText === optionLabel ? '' : rawValue,
        };
      },
      { fillable: FILLABLE_ROLES, never: NEVER_ROLES, maxOptions: MAX_OPTIONS },
    )
    .catch(() => null);
}

/**
 * Ask the server for the options matching `query`, for a data source that only
 * ever hands over one page at a time.
 *
 * Country of Nationality is the case that forces this: 200 countries, 30 per
 * page, so the loaded page holds Afghanistan through Bhutan and nothing this
 * applicant needs. Filtering is exactly what the widget itself does when
 * somebody types into it, and it is a read — no value is chosen here.
 */
async function searchOptions(el, query, textField) {
  return el
    .evaluate(
      (node, { query, textField, maxOptions }) =>
        new Promise((resolve) => {
          const $ = window.jQuery || window.$;
          const widget =
            $(node).data('kendoDropDownList') ||
            $(node).data('kendoComboBox') ||
            $(node).data('kendoAutoComplete');
          if (!widget || !widget.dataSource) return resolve([]);

          let settled = false;
          const collect = () => {
            if (settled) return;
            settled = true;
            const rows = widget.dataSource.data();
            const out = [];
            for (let i = 0; i < rows.length && i < maxOptions; i += 1) {
              const text = rows[i][textField];
              const value = rows[i][widget.options.dataValueField];
              if (text === undefined || text === null) continue;
              out.push({
                text: String(text),
                value: value === null || value === undefined ? '' : String(value),
              });
            }
            resolve(out);
          };

          // Whichever arrives first: the data source reporting new data, or a
          // timeout. A portal that never answers must not hang the run — it
          // just means this field stays empty and gets reported.
          const timer = setTimeout(collect, 6000);
          widget.dataSource.one('change', () => {
            clearTimeout(timer);
            collect();
          });

          try {
            widget.dataSource.filter({ field: textField, operator: 'contains', value: query });
          } catch {
            clearTimeout(timer);
            collect();
          }
        }),
      { query, textField, maxOptions: MAX_OPTIONS },
    )
    .catch(() => []);
}

/**
 * Put the widget's list back the way it was found.
 *
 * A filter left in place leaves the applicant with a country dropdown that
 * offers exactly one country. Whatever this module does to look something up,
 * the control it hands back has to behave normally.
 */
async function clearSearch(el) {
  await el
    .evaluate(
      (node) =>
        new Promise((resolve) => {
          const $ = window.jQuery || window.$;
          const widget =
            $(node).data('kendoDropDownList') ||
            $(node).data('kendoComboBox') ||
            $(node).data('kendoAutoComplete');
          if (!widget || !widget.dataSource) return resolve();

          // Waited on, not fired and forgotten. Restoring the list is a second
          // round trip that lands after this call would otherwise have
          // returned, and the caller checks afterwards that the choice
          // survived it — a check that proves nothing if the reload has not
          // happened yet.
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          const timer = setTimeout(done, 4000);
          widget.dataSource.one('change', () => {
            clearTimeout(timer);
            done();
          });
          try {
            widget.dataSource.filter({});
          } catch {
            clearTimeout(timer);
            done();
          }
        }),
    )
    .catch(() => {});
}

/**
 * Values that name the same answer in the two languages this portal mixes.
 *
 * The page renders in English but its parameter lists come back however the
 * server has them, and an applicant.json written by a person says "No" or
 * "e-mail" rather than "Hayır" or "e-Posta". Matching only the literal string
 * left mandatory dropdowns empty for no better reason than vocabulary.
 *
 * Every entry is a set of words that mean one thing. Nothing here decides
 * BETWEEN options — it only widens what counts as naming the same one.
 */
const SYNONYMS = [
  ['yes', 'evet', 'true', 'y'],
  ['no', 'hayir', 'false', 'n'],
  ['e mail', 'email', 'e posta', 'eposta', 'mail'],
  ['cell phone', 'cep telefonu', 'cep telefon', 'phone', 'sms', 'mobile', 'gsm'],
  ['male', 'erkek', 'm'],
  ['female', 'kadin', 'f'],
  ['single', 'bekar'],
  ['married', 'evli'],
  ['ordinary passport', 'umuma mahsus pasaport', 'umuma mahsus'],
  ['turkey', 'turkiye', 'turkiye cumhuriyeti'],
];

/**
 * Fold for comparing an ANSWER to an OPTION, which is a looser job than
 * matching a label.
 *
 * Punctuation carries no meaning here: "e-Mail", "e Mail" and "eMail" are one
 * option written three ways, and the applicant writes a fourth. The shared
 * `fold` deliberately leaves punctuation alone because it is also applied to
 * regular-expression sources, where a stripped backslash changes what the
 * pattern means — so the extra step belongs here rather than in it.
 */
function norm(v) {
  return fold(v)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Every word that means the same as `v`, normalised — `v` itself included. */
function aliases(v) {
  const key = norm(v);
  const group = SYNONYMS.find((set) => set.includes(key));
  return group ? [...new Set([key, ...group])] : [key];
}

/**
 * Find the one option that means `value`, or nothing.
 *
 * Exact beats prefix beats substring, and each tier is only accepted when it
 * produces a single candidate. Two plausible options is not a near miss to be
 * broken by ordering — on a residence-permit form it is a wrong answer waiting
 * to be submitted, so it is refused and reported instead.
 */
export function matchOption(items, value) {
  const wanted = aliases(value);
  const rows = (items ?? []).map((o) => ({ ...o, folded: norm(o.text) })).filter((o) => o.folded);

  for (const test of [
    (o) => wanted.includes(o.folded),
    (o) => wanted.some((w) => o.folded.startsWith(w)),
    (o) => wanted.some((w) => o.folded.includes(w) || (w.length >= 4 && w.includes(o.folded))),
  ]) {
    const hits = rows.filter(test);
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return null;
  }
  return null;
}

/**
 * Commit a resolved option to the widget.
 *
 * `trigger('change')` is not decoration. Kendo's MVVM writes the widget's
 * value into the view model on its change event, and the view model — not the
 * input — is what the form posts. Without it the dropdown reads correctly on
 * screen and submits nothing, which is the worst of the available failures.
 */
async function commitOption(el, optionValue) {
  return el
    .evaluate((node, wanted) => {
      const $ = window.jQuery || window.$;
      const widget =
        $(node).data('kendoDropDownList') ||
        $(node).data('kendoComboBox') ||
        $(node).data('kendoAutoComplete');
      if (!widget) return { ok: false, text: '' };
      widget.value(wanted);
      widget.trigger('change');
      return {
        ok: String(widget.value() ?? '') === String(wanted),
        text: typeof widget.text === 'function' ? String(widget.text() ?? '') : '',
      };
    }, optionValue)
    .catch(() => ({ ok: false, text: '' }));
}

/**
 * Write a value into a Kendo widget. Returns true only when the widget itself
 * confirms it now holds what was intended.
 *
 * A false return always means the same thing throughout this project: the box
 * is left empty and reported, because a field that looks filled and is wrong
 * is worse than one that is visibly blank.
 */
export async function setValue(el, info, value) {
  if (!info || !info.owns || info.disabled) return false;
  const wanted = String(value ?? '').trim();
  if (!wanted) return false;

  if (info.kind === 'list') {
    let match = matchOption(info.items, wanted);
    let searched = false;

    // Not on the loaded page — ask the server for it before concluding the
    // portal does not offer it.
    if (!match && !info.complete && info.serverFiltering) {
      searched = true;
      const found = await searchOptions(el, wanted, info.textField);
      match = matchOption(found, wanted);
    }
    if (!match) {
      if (searched) await clearSearch(el);
      return false;
    }

    const committed = await commitOption(el, match.value);
    if (searched) await clearSearch(el);
    if (!committed.ok) return false;

    // Read the widget again, after the list has been put back.
    //
    // Two things have to hold, and only the final state can show either. The
    // widget must SAY the option and not just hold its code — a code sitting
    // behind the text "Please select..." is the desynchronised state this
    // module exists to prevent — and it must still say it once the search
    // filter has been lifted, since restoring the list is itself a reload
    // that a lesser widget could lose the selection to.
    const after = await describe(el);
    if (!after || after.kind !== 'list' || !after.value) return false;
    return norm(after.text) === norm(match.text);
  }

  if (info.kind === 'masked') {
    // A mask accepts the characters it was defined with and nothing else. The
    // portal's phone mask is "(999) 000-00-00", so a number written with a
    // country code or with spaces has to be reduced to its digits, and to the
    // right count of them, or the mask takes what fits and drops the rest.
    const digits = wanted.replace(/\D/g, '');
    const width = (info.mask.match(/[09#&?AL]/g) || []).length;
    const payload = width && digits.length > width ? digits.slice(-width) : digits;
    if (!payload) return false;

    return el
      .evaluate((node, v) => {
        const $ = window.jQuery || window.$;
        const widget = $(node).data('kendoMaskedTextBox');
        if (!widget) return false;
        widget.value(v);
        widget.trigger('change');
        const got = String(widget.value() ?? '');
        // Any placeholder character left over means the mask took only part
        // of what it was given. Half a phone number is cleared, not kept.
        if (/_/.test(got)) {
          widget.value('');
          widget.trigger('change');
          return false;
        }
        return got.replace(/\D/g, '') === v;
      }, payload)
      .catch(() => false);
  }

  if (info.kind === 'numeric') {
    const n = Number(String(wanted).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n)) return false;
    return el
      .evaluate((node, v) => {
        const $ = window.jQuery || window.$;
        const widget = $(node).data('kendoNumericTextBox');
        if (!widget) return false;
        widget.value(v);
        widget.trigger('change');
        return Number(widget.value()) === v;
      }, n)
      .catch(() => false);
  }

  if (info.kind === 'date') {
    return el
      .evaluate((node, v) => {
        const $ = window.jQuery || window.$;
        const widget = $(node).data('kendoDatePicker') || $(node).data('kendoDateTimePicker');
        if (!widget) return false;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return false;
        widget.value(d);
        widget.trigger('change');
        return widget.value() instanceof Date;
      }, value)
      .catch(() => false);
  }

  return false;
}

/**
 * Where the control actually is on screen, so the on-page cursor can point at
 * it while it is being filled.
 *
 * The element being written is `display:none`, so asking Playwright for its
 * box returns nothing and the cursor skipped straight past the dropdowns —
 * the fields whose filling somebody watching would most want to see. Scrolls
 * the visible wrapper into view and reports its viewport rectangle.
 */
export async function pointTarget(el) {
  return el
    .evaluate((node) => {
      const $ = window.jQuery || window.$;
      const widget = $ && $.fn ? $(node).data() : null;
      const instance = widget
        ? Object.keys(widget)
            .filter((k) => k.startsWith('kendo'))
            .map((k) => widget[k])[0]
        : null;
      const wrapper =
        (instance && instance.wrapper && instance.wrapper[0]) ||
        (node.parentElement && node.parentElement.classList.contains('k-widget')
          ? node.parentElement
          : node.closest('.k-widget')) ||
        node;
      wrapper.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = wrapper.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return null;
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })
    .catch(() => null);
}

/**
 * The adapter object the shared engine talks to.
 *
 * Kept to three questions — is this yours, what is in it, please write this —
 * so the engine stays a form-walker that knows nothing about Kendo, and this
 * file stays the only place that does.
 */
export const KENDO_WIDGETS = {
  describe,
  setValue,
  pointTarget,
  /** Options as plain strings, for the model to choose between. */
  optionTexts: (info) => (info && info.kind === 'list' ? info.items.map((o) => o.text) : null),
};
