'use strict';

/* Progressive enhancements for the enquiry inbox and detail workflow.
 * Django retains ownership of every form, filter link and table interaction.
 */
{
    const listPage = document.querySelector('[data-enquiry-workbench]');

    if (listPage) {
        const filterToggle = listPage.querySelector('[data-enquiry-filter-toggle]');
        const filterPanel = listPage.querySelector('[data-enquiry-filter-panel]');
        const filterClose = filterPanel?.querySelector('.eq-filter-close');

        if (filterToggle && filterPanel && filterClose) {
            const mobile = window.matchMedia('(max-width: 900px)');
            let expanded = false;

            function setFiltersExpanded(next, {restoreFocus = false} = {}) {
                expanded = Boolean(next);
                filterToggle.setAttribute('aria-expanded', String(expanded));
                filterPanel.hidden = mobile.matches && !expanded;

                if (mobile.matches && expanded) {
                    window.requestAnimationFrame(() => {
                        filterPanel.querySelector('summary, a[href], button')?.focus();
                    });
                } else if (restoreFocus) {
                    filterToggle.focus();
                }
            }

            function syncFilterLayout() {
                filterToggle.hidden = !mobile.matches;
                if (mobile.matches) {
                    setFiltersExpanded(false);
                } else {
                    expanded = false;
                    filterToggle.setAttribute('aria-expanded', 'false');
                    filterPanel.hidden = false;
                }
            }

            filterToggle.addEventListener('click', () => setFiltersExpanded(!expanded));
            filterClose.addEventListener('click', () => {
                setFiltersExpanded(false, {restoreFocus: true});
            });
            document.addEventListener('keydown', (event) => {
                if (event.key === 'Escape' && mobile.matches && expanded) {
                    event.preventDefault();
                    setFiltersExpanded(false, {restoreFocus: true});
                }
            });
            mobile.addEventListener('change', syncFilterLayout);
            syncFilterLayout();
        }

        const results = listPage.querySelector('#changelist-form .results');
        if (results) {
            results.tabIndex = 0;
            results.setAttribute('aria-label', 'Enquiry results table');
        }

        // Compatibility for a deployment where state is still the raw model
        // field rather than EnquiryAdmin.state_summary(). Newer rows already
        // carry .eq-state and are left completely untouched.
        const stateNames = {
            'Awaiting phone verification': 'pending_verification',
            'Sent to provider': 'sent',
            'Delivery failed': 'failed',
            'Marked as spam': 'spam',
        };
        listPage.querySelectorAll('td.field-state').forEach((cell) => {
            if (cell.querySelector('.eq-state')) return;
            const label = cell.textContent.trim();
            const state = stateNames[label];
            if (!state) return;

            const badge = document.createElement('span');
            badge.className = `eq-state eq-state--${state}`;
            const dot = document.createElement('span');
            dot.setAttribute('aria-hidden', 'true');
            badge.append(dot, document.createTextNode(label));
            cell.replaceChildren(badge);
        });
    }

    const enquiryForm = document.querySelector('.enquiry-workflow-page #enquiry_form');
    const saveDock = enquiryForm?.querySelector('[data-enquiry-save-dock]');

    if (enquiryForm && saveDock) {
        const status = saveDock.querySelector('.eq-save-dock__context > div');
        const title = status?.querySelector('strong');
        const detail = status?.querySelector('span');

        function markDirty() {
            if (saveDock.dataset.dirty === 'true') return;
            saveDock.dataset.dirty = 'true';
            if (title) title.textContent = saveDock.dataset.dirtyTitle;
            if (detail) detail.textContent = saveDock.dataset.dirtyDetail;
        }

        enquiryForm.addEventListener('input', markDirty);
        enquiryForm.addEventListener('change', markDirty);
        enquiryForm.addEventListener('submit', () => {
            saveDock.dataset.dirty = 'false';
        });
    }
}
