'use strict';

/*
 * Behaviour layered on top of Django 5.2's nav_sidebar.js.
 *
 * Django still owns the open/closed state and its localStorage key. Keeping
 * that contract means upgrades, the desktop rail and the mobile drawer all
 * agree about whether the sidebar is open. This file adds the product-level
 * behaviour Django does not provide: collapsible app groups, full-navigation
 * filtering, keyboard shortcuts and an accessible mobile drawer.
 */
{
    const APP_STATE_KEY = 'skillshub.admin.sidebar.apps';
    const FILTER_STATE_KEY = 'django.admin.navSidebarFilterValue';
    const DRAWER_QUERY = '(max-width: 767px)';

    const main = document.getElementById('main');
    const sidebar = document.getElementById('nav-sidebar');
    const toggle = document.getElementById('toggle-nav-sidebar');
    const filter = document.getElementById('nav-filter');
    const filterEmpty = document.getElementById('nav-filter-empty');

    if (main && sidebar && toggle && filter) {
        const media = window.matchMedia(DRAWER_QUERY);
        const content = main.querySelector(':scope > .content');
        const appGroups = Array.from(sidebar.querySelectorAll('[data-sidebar-app]'));
        const searchItems = Array.from(sidebar.querySelectorAll('[data-nav-search-item]'));
        const searchGroups = Array.from(sidebar.querySelectorAll('[data-nav-search-group]'));
        const defaultAppState = Object.fromEntries(
            appGroups.map((group) => [group.dataset.sidebarApp, group.open])
        );

        let appState = {};
        let applyingAppState = false;

        try {
            appState = JSON.parse(localStorage.getItem(APP_STATE_KEY) || '{}');
        } catch (error) {
            appState = {};
        }

        const isDrawer = () => media.matches;
        const isOpen = () => main.classList.contains('shifted');

        function updateDrawerState({focusFilter = false} = {}) {
            const open = isOpen();
            const drawer = isDrawer();

            toggle.setAttribute('aria-expanded', String(open));
            toggle.setAttribute(
                'aria-label',
                open ? toggle.dataset.labelClose : toggle.dataset.labelOpen
            );
            sidebar.inert = drawer && !open;
            if (content) {
                content.inert = drawer && open;
            }
            document.body.classList.toggle('sb-drawer-open', drawer && open);

            if (drawer && open && focusFilter) {
                window.requestAnimationFrame(() => filter.focus());
            }
        }

        function closeDrawer({restoreFocus = false} = {}) {
            if (!isDrawer() || !isOpen()) {
                return;
            }
            // Delegate to Django so its closure, class and storage value stay
            // synchronized rather than changing .shifted behind its back.
            toggle.click();
            if (restoreFocus) {
                window.requestAnimationFrame(() => toggle.focus());
            }
        }

        function storedOpenState(group) {
            const key = group.dataset.sidebarApp;
            if (Object.prototype.hasOwnProperty.call(appState, key)) {
                return Boolean(appState[key]);
            }
            return Boolean(defaultAppState[key]);
        }

        function restoreAppGroups() {
            applyingAppState = true;
            for (const group of appGroups) {
                group.open = storedOpenState(group);
            }
            applyingAppState = false;
        }

        function storeAppGroups() {
            try {
                localStorage.setItem(APP_STATE_KEY, JSON.stringify(appState));
            } catch (error) {
                // The native <details> controls still work when storage is
                // unavailable; only remembering them is lost.
            }
        }

        function searchableText(item) {
            return (item.dataset.navSearchText || item.textContent || '')
                .trim()
                .toLocaleLowerCase();
        }

        function applyFilter() {
            const query = filter.value.trim().toLocaleLowerCase();
            let matches = 0;

            for (const item of searchItems) {
                const matched = !query || searchableText(item).includes(query);
                item.hidden = !matched;
                if (query && matched) {
                    matches += 1;
                }
            }

            applyingAppState = true;
            for (const group of appGroups) {
                const models = Array.from(group.querySelectorAll('[data-nav-search-item]'));
                const hasMatch = models.some((item) => !item.hidden);
                group.hidden = Boolean(query) && !hasMatch;
                group.open = query && hasMatch ? true : storedOpenState(group);
            }
            applyingAppState = false;

            for (const group of searchGroups) {
                const items = Array.from(group.querySelectorAll('[data-nav-search-item]'));
                group.hidden = Boolean(query) && !items.some((item) => !item.hidden);
            }

            const noResults = Boolean(query) && matches === 0;
            filter.classList.toggle('no-results', noResults);
            filter.setAttribute('aria-invalid', String(noResults));
            if (filterEmpty) {
                filterEmpty.hidden = !noResults;
            }

            try {
                sessionStorage.setItem(FILTER_STATE_KEY, query);
            } catch (error) {
                // Filtering itself does not depend on storage.
            }
        }

        restoreAppGroups();

        for (const group of appGroups) {
            group.addEventListener('toggle', () => {
                if (applyingAppState || filter.value.trim()) {
                    return;
                }
                appState[group.dataset.sidebarApp] = group.open;
                storeAppGroups();
            });
        }

        // Register the same events Django uses. Its listener runs first and
        // filters the compatible <tr> rows; this listener then hides empty app
        // groups, includes queues/Overview, and owns the final no-results state.
        for (const eventName of ['change', 'input', 'keyup']) {
            filter.addEventListener(eventName, applyFilter, false);
        }
        applyFilter();

        document.addEventListener('keydown', (event) => {
            const target = event.target;
            const isTyping = target instanceof HTMLElement && (
                target.matches('input, textarea, select') || target.isContentEditable
            );

            if (event.key === '/' && !isTyping && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                if (isDrawer() && !isOpen()) {
                    toggle.click();
                }
                filter.focus();
                return;
            }

            if (event.key === 'Escape' && isDrawer() && isOpen()) {
                event.preventDefault();
                closeDrawer({restoreFocus: true});
                return;
            }

            if (event.key === 'Tab' && isDrawer() && isOpen()) {
                const focusable = Array.from(sidebar.querySelectorAll(
                    'a[href], button:not([disabled]), summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])'
                )).filter((element) => !element.hidden && element.getClientRects().length > 0);
                if (!focusable.length) {
                    return;
                }
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        });

        // The scrim is .main::after, so a tap on it is reported against #main.
        main.addEventListener('click', (event) => {
            if (isDrawer() && event.target === main) {
                closeDrawer({restoreFocus: true});
            }
        });

        // Close before navigation so Django persists "closed" for the next
        // mobile page instead of making the new page load underneath a drawer.
        sidebar.addEventListener('click', (event) => {
            if (isDrawer() && event.target.closest('a')) {
                closeDrawer();
            }
        });

        // Read Django's final state on the next frame. Script execution order
        // can otherwise make this handler observe the class before Django has
        // toggled it, leaving keyboard focus on the menu button.
        toggle.addEventListener('click', () => {
            window.requestAnimationFrame(() => updateDrawerState({focusFilter: true}));
        });
        media.addEventListener('change', updateDrawerState);

        const observer = new MutationObserver(() => updateDrawerState());
        observer.observe(main, {attributes: true, attributeFilter: ['class']});
        updateDrawerState();
    }
}
