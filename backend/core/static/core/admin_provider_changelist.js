'use strict';

/* Small-screen filter disclosure for the Provider workbench.
 *
 * Django continues to own filter links and <details> state. This script only
 * removes the long filter column from the mobile reading order until an
 * officer asks for it; without JavaScript the panel remains visible.
 */
{
    const page = document.querySelector('.pc-page');
    const toggle = page?.querySelector('[data-provider-filter-toggle]');
    const panel = page?.querySelector('[data-provider-filter-panel]');
    const close = panel?.querySelector('.pc-filter-close');

    if (page && toggle && panel && close) {
        const mobile = window.matchMedia('(max-width: 900px)');
        let expanded = false;

        function setExpanded(next, {restoreFocus = false} = {}) {
            expanded = Boolean(next);
            toggle.setAttribute('aria-expanded', String(expanded));
            panel.hidden = mobile.matches && !expanded;

            if (mobile.matches && expanded) {
                window.requestAnimationFrame(() => {
                    const firstControl = panel.querySelector('summary, a[href], button');
                    firstControl?.focus();
                });
            } else if (restoreFocus) {
                toggle.focus();
            }
        }

        function syncLayout() {
            toggle.hidden = !mobile.matches;
            if (mobile.matches) {
                setExpanded(false);
            } else {
                expanded = false;
                toggle.setAttribute('aria-expanded', 'false');
                panel.hidden = false;
            }
        }

        toggle.addEventListener('click', () => setExpanded(!expanded));
        close.addEventListener('click', () => setExpanded(false, {restoreFocus: true}));

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && mobile.matches && expanded) {
                event.preventDefault();
                setExpanded(false, {restoreFocus: true});
            }
        });

        mobile.addEventListener('change', syncLayout);
        syncLayout();
    }

    // The stock result template is intentionally retained. Giving its
    // overflow wrapper a tab stop lets keyboard users pan wide tables on a
    // narrow screen without changing the table's semantics.
    const results = page?.querySelector('#changelist-form .results');
    if (results) {
        results.tabIndex = 0;
        results.setAttribute('aria-label', 'Provider results table');
    }
}
