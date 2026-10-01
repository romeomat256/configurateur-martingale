/* Local conversion hooks only: no cookies, storage, network calls, or personal data.
 * An analytics integration may subscribe to "martingale:analytics" after configuration.
 * quote_submit_attempt is NOT a successful submission. quote_sent is reserved for
 * a confirmed response from the future quote-delivery backend.
 */
window.MartingaleAnalytics = Object.freeze({
  track(event, context = {}) {
    if (!['structure_selected','weave_selected','quote_opened','quote_submit_attempt','quote_sent','pdf_generated','pdf_failed'].includes(event)) return;
    const detail = { event };
    for (const key of ['shape','weave','outcome']) {
      if (typeof context[key] === 'string' && /^[a-z_]{1,32}$/.test(context[key])) detail[key] = context[key];
    }
    window.dispatchEvent(new CustomEvent('martingale:analytics', { detail: Object.freeze(detail) }));
  }
});
