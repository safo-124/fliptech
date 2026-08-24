'use strict';

/* Progressive catalog enhancements. Django remains authoritative for form
 * submission, filters, actions, autocomplete, prepopulation and formsets.
 */
{
    const listPage = document.querySelector('[data-catalog-changelist]');

    if (listPage) {
        const toggle = listPage.querySelector('[data-catalog-filter-toggle]');
        const panel = listPage.querySelector('[data-catalog-filter-panel]');
        const close = listPage.querySelector('[data-catalog-filter-close]');

        if (toggle && panel && close) {
            const mobile = window.matchMedia('(max-width: 900px)');
            let expanded = false;

            function setExpanded(next, {restoreFocus = false} = {}) {
                expanded = Boolean(next);
                toggle.setAttribute('aria-expanded', String(expanded));
                panel.hidden = mobile.matches && !expanded;

                if (mobile.matches && expanded) {
                    window.requestAnimationFrame(() => {
                        panel.querySelector('summary, a[href], button:not([disabled])')?.focus();
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

            if (typeof mobile.addEventListener === 'function') {
                mobile.addEventListener('change', syncLayout);
            } else {
                mobile.addListener(syncLayout);
            }
            syncLayout();
        }

        const results = listPage.querySelector('#changelist-form .results');
        if (results) {
            const kind = listPage.dataset.catalogKind || 'catalog';
            results.tabIndex = 0;
            results.setAttribute('aria-label', `${kind} results table`);
        }

        const queueNav = listPage.querySelector('[data-catalog-queue-nav]');
        if (queueNav) {
            const links = Array.from(queueNav.querySelectorAll('a[href]'));
            queueNav.addEventListener('keydown', (event) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
                const current = links.indexOf(document.activeElement);
                if (current < 0) return;
                event.preventDefault();
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                links[(current + direction + links.length) % links.length].focus();
            });
        }
    }

    const catalogForm = document.querySelector('.catalog-form-page #content-main form');
    const saveDock = catalogForm?.querySelector('[data-catalog-save-dock]');

    if (catalogForm && saveDock) {
        const title = saveDock.querySelector('.cat-save-dock__context strong');
        const dirtyTitle = saveDock.dataset.catalogDirtyTitle;

        function markDirty() {
            if (saveDock.dataset.catalogDirty === 'true') return;
            saveDock.dataset.catalogDirty = 'true';
            if (title && dirtyTitle) title.textContent = dirtyTitle;
        }

        catalogForm.addEventListener('input', markDirty);
        catalogForm.addEventListener('change', markDirty);
        catalogForm.addEventListener('submit', () => {
            saveDock.dataset.catalogDirty = 'false';
        });
    }
}
