'use strict';

/* Enrolment reporting interactions.
 *
 * Django continues to own the forms, actions, filters, and autocomplete
 * widgets. This file adds only progressive enhancements: a small-screen filter
 * disclosure, keyboard-pannable results, and plain-language outcome signals
 * beside the native change form.
 */
{
    const listPage = document.querySelector('[data-enrolment-changelist]');

    if (listPage) {
        const toggle = listPage.querySelector('[data-enrolment-filter-toggle]');
        const panel = listPage.querySelector('[data-enrolment-filter-panel]');
        const close = panel?.querySelector('.er-filter-close');

        if (toggle && panel && close) {
            const mobile = window.matchMedia('(max-width: 900px)');
            let expanded = false;

            function setExpanded(next, {restoreFocus = false} = {}) {
                expanded = Boolean(next);
                toggle.setAttribute('aria-expanded', String(expanded));
                panel.hidden = mobile.matches && !expanded;
                document.body.classList.toggle('er-filters-open', mobile.matches && expanded);

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
                    document.body.classList.remove('er-filters-open');
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
            results.setAttribute('aria-label', 'Enrolment results table');
        }
    }

    const formSignals = document.querySelector('[data-enrolment-form-signals]');

    if (formSignals) {
        const completedOn = document.getElementById('id_completed_on');
        const attestation = document.getElementById('id_provider_attestation');
        const attestedOn = document.getElementById('id_attested_on');
        const enquiry = document.getElementById('id_enquiry');

        const completionCard = formSignals.querySelector('[data-enrolment-signal="completion"]');
        const attestationCard = formSignals.querySelector('[data-enrolment-signal="attestation"]');
        const sourceCard = formSignals.querySelector('[data-enrolment-signal="source"]');
        const completionLive = document.getElementById('er-completion-live');
        const attestationLive = document.getElementById('er-attestation-live');
        const sourceLive = document.getElementById('er-source-live');

        function setSignal(card, output, text, tone) {
            if (!card || !output) {
                return;
            }
            card.dataset.tone = tone;
            output.textContent = text;
        }

        function updateSignals() {
            const completed = Boolean(completedOn?.value);
            setSignal(
                completionCard,
                completionLive,
                completed ? 'Completion recorded' : 'Still in training or unknown',
                completed ? 'positive' : 'neutral'
            );

            const attestationValue = attestation?.value || 'not_asked';
            let attestationText = 'Not asked yet';
            let attestationTone = 'attention';
            if (attestationValue === 'recommended') {
                attestationText = attestedOn?.value
                    ? 'Recommended for paid work'
                    : 'Recommended — add the attestation date';
                attestationTone = attestedOn?.value ? 'positive' : 'warning';
            } else if (attestationValue === 'not_recommended') {
                attestationText = attestedOn?.value
                    ? 'Not recommended for paid work'
                    : 'Not recommended — add the attestation date';
                attestationTone = 'warning';
            }
            setSignal(attestationCard, attestationLive, attestationText, attestationTone);

            setSignal(
                sourceCard,
                sourceLive,
                enquiry?.value ? 'Linked to a platform enquiry' : 'Provider-reported enrolment',
                enquiry?.value ? 'positive' : 'neutral'
            );
        }

        for (const field of [completedOn, attestation, attestedOn, enquiry]) {
            field?.addEventListener('change', updateSignals);
            field?.addEventListener('input', updateSignals);
        }
        updateSignals();
    }
}
