'use strict';

/* Progressive enhancements for Region and Area admin pages. Native Django
 * forms, filters, prepopulation and the OpenLayers widget remain authoritative.
 */
{
    const listPage = document.querySelector('[data-geography-changelist]');

    if (listPage) {
        const toggle = listPage.querySelector('[data-geography-filter-toggle]');
        const panel = listPage.querySelector('[data-geography-filter-panel]');
        const close = panel?.querySelector('.geo-filter-close');

        if (toggle && panel && close) {
            const mobile = window.matchMedia('(max-width: 900px)');
            let expanded = false;

            function setExpanded(next, {restoreFocus = false} = {}) {
                expanded = Boolean(next);
                toggle.setAttribute('aria-expanded', String(expanded));
                panel.hidden = mobile.matches && !expanded;

                if (mobile.matches && expanded) {
                    window.requestAnimationFrame(() => {
                        panel.querySelector('summary, a[href], button')?.focus();
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

        const results = listPage.querySelector('#changelist-form .results');
        if (results) {
            results.tabIndex = 0;
            results.setAttribute('aria-label', 'Geography results table');
        }
    }

    const geographyForm = document.querySelector('.geography-form-page #content-main form');
    const saveDock = geographyForm?.querySelector('[data-geography-save-dock]');

    if (geographyForm && saveDock) {
        const status = saveDock.querySelector('.geo-save-dock__context > div');
        const title = status?.querySelector('strong');

        function markDirty() {
            if (saveDock.dataset.dirty === 'true') return;
            saveDock.dataset.dirty = 'true';
            if (title) title.textContent = saveDock.dataset.dirtyTitle;
        }

        geographyForm.addEventListener('input', markDirty);
        geographyForm.addEventListener('change', markDirty);
        geographyForm.addEventListener('submit', () => {
            saveDock.dataset.dirty = 'false';
        });
    }
}
