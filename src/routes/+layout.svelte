<script lang="ts">
	import './layout.css';
	import { fade, fly } from 'svelte/transition';
	import { afterNavigate } from '$app/navigation';
	import { getSurah } from '$lib/quran/data';
	import { dur } from '$lib/motion';
	import { m } from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
	import { app, arabicFontStacks, darkThemes } from '$lib/app-state.svelte';
	import ActivityBar from '$lib/components/ActivityBar.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import OfflineSetup from '$lib/components/OfflineSetup.svelte';
	import NowPlayingPill from '$lib/components/NowPlayingPill.svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Prerendered shells bake lang="en" (no locale cookie at build time); the
	// real locale is only known client-side, so stamp it for :lang() CSS and AT.
	document.documentElement.lang = getLocale();

	// Panes in visual order: activity bar, sidebar, main, info pane.
	function visiblePanes(): HTMLElement[] {
		return [...document.querySelectorAll<HTMLElement>('[data-pane]')].filter(
			(pane) => pane.getBoundingClientRect().width > 0
		);
	}

	function focusPane(pane: HTMLElement | undefined) {
		if (!pane) return;
		// Reader: land on the topmost visible verse so focus is visible and
		// j/k work immediately.
		if (pane.matches('main')) {
			const top = pane.getBoundingClientRect().top;
			const verse = [...pane.querySelectorAll<HTMLElement>('[data-verse]')].find(
				(article) => article.getBoundingClientRect().bottom > top + 16
			);
			if (verse) {
				verse.focus();
				return;
			}
		}
		// Otherwise prefer the active item, then an input, then any control.
		(
			pane.querySelector<HTMLElement>('[aria-current="page"]') ??
			pane.querySelector<HTMLElement>('input') ??
			pane.querySelector<HTMLElement>('a[href], button:not([tabindex="-1"]), [tabindex="0"]') ??
			(pane.hasAttribute('tabindex') ? pane : null)
		)?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		const noModifiers = !event.metaKey && !event.ctrlKey && !event.altKey;
		const target = event.target as HTMLElement;
		const typing = !!target.closest?.('input, textarea');

		// 1–4 jump straight to a pane (physical keys, so any layout works).
		// Bare digits outside inputs; Alt+digit even while typing.
		const digit = /^Digit([1-4])$/.exec(event.code ?? '')?.[1];
		const altOnly = event.altKey && !event.metaKey && !event.ctrlKey;
		if (digit && ((noModifiers && !typing) || altOnly)) {
			const pane = visiblePanes()[Number(digit) - 1];
			if (pane) {
				event.preventDefault();
				focusPane(pane);
			}
			return;
		}
		// F6 / Shift+F6 cycle panes (a11y standard).
		if (event.key === 'F6') {
			event.preventDefault();
			const panes = visiblePanes();
			const current = panes.findIndex((pane) => pane.contains(document.activeElement));
			const step = event.shiftKey ? -1 : 1;
			focusPane(panes[(current + step + panes.length) % panes.length]);
			return;
		}
		if (event.key === 'Escape') {
			// First Escape leaves the input, so bare shortcuts work again.
			if (typing) {
				target.blur();
				return;
			}
			if (app.mobileSidebarOpen) app.closeMobileSidebar();
			return;
		}
		if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
		if (event.key === 'b') {
			event.preventDefault();
			app.toggleSidebar();
		} else if (event.key === 'f') {
			// Native find can't see lazily-mounted verses — our search can.
			event.preventDefault();
			app.focusSearch();
		}
	}

	afterNavigate(() => app.closeMobileSidebar());

	// Theme is data-theme on <html>; dark themes also get the .dark class so
	// the `dark:` Tailwind variant (prose-invert) keeps working. The pre-paint
	// script in app.html set an inline background/color-scheme before CSS was
	// available — clear those so the stylesheet owns them from here on.
	$effect(() => {
		const theme = app.prefs.theme;
		const root = document.documentElement;
		root.dataset.theme = theme;
		root.classList.toggle('dark', darkThemes.has(theme));
		root.style.backgroundColor = '';
		root.style.colorScheme = '';
		document
			.querySelector('meta[name="theme-color"]')
			?.setAttribute('content', getComputedStyle(root).getPropertyValue('--paper').trim());
	});

	$effect(() => {
		document.documentElement.style.setProperty(
			'--arabic-font',
			arabicFontStacks[app.prefs.arabicFont]
		);
	});

	$effect(() => {
		document.documentElement.style.setProperty('--arabic-size', `${app.prefs.arabicSize}rem`);
	});

	// Browsers only re-check the service worker script on navigation and every
	// ~24h — an installed PWA that stays open would ride an old deploy for
	// days. Nudge the check whenever the app regains visibility.
	$effect(() => {
		if (!('serviceWorker' in navigator)) return;
		const check = () => {
			if (document.visibilityState === 'visible')
				void navigator.serviceWorker.getRegistration().then((reg) => reg?.update());
		};
		document.addEventListener('visibilitychange', check);
		return () => document.removeEventListener('visibilitychange', check);
	});

	// Local-first: once the app settles, quietly pull every surah into memory
	// (~8.6MB JSON) during idle time so any surah switch is instant.
	$effect(() => {
		// navigator.connection is non-standard, hence the manual typing.
		const connection = (
			navigator as { connection?: { saveData?: boolean; effectiveType?: string } }
		).connection;
		if (connection?.saveData) return;
		if (connection?.effectiveType && connection.effectiveType !== '4g') return;
		let cancelled = false;
		let n = 1;
		const schedule = (fn: () => void) =>
			'requestIdleCallback' in window
				? requestIdleCallback(fn, { timeout: 1000 })
				: setTimeout(fn, 150);
		const next = () => {
			if (cancelled || n > 114) return;
			getSurah(fetch, n++)
				.catch(() => {})
				.finally(() => schedule(next));
		};
		const timer = setTimeout(() => next(), 2000);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});
</script>

<svelte:head>
	<title>Tadabbur</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} />

<div
	class="flex h-dvh overflow-hidden pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[calc(3.5rem+env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] md:pb-0"
>
	<a
		href="#main-content"
		class="sr-only focus:not-sr-only focus:bg-surface focus:text-body focus:absolute focus:top-2 focus:left-14 focus:z-50 focus:rounded-lg focus:border focus:border-edge focus:px-3 focus:py-1.5 focus:text-sm focus:shadow-lg"
	>
		{m.skip_to_content()}
	</a>
	<ActivityBar />

	{#if app.mobileSidebarOpen}
		<button
			type="button"
			class="fixed inset-0 z-30 bg-black/40 md:hidden"
			aria-label="Close sidebar"
			transition:fade={{ duration: dur(150) }}
			onclick={() => app.closeMobileSidebar()}
		></button>
	{/if}

	{#if app.mobileSidebarOpen || app.prefs.sidebarOpen}
		<div
			transition:fly={{ x: -16, duration: dur(180) }}
			class="{app.mobileSidebarOpen
				? 'fixed top-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] left-0 z-40 flex shadow-xl'
				: 'hidden'} {app.prefs.sidebarOpen
				? 'md:static md:z-auto md:flex md:shadow-none'
				: 'md:hidden'}"
		>
			<Sidebar chapters={data.chapters} />
		</div>
	{/if}

	{@render children()}

	<NowPlayingPill chapters={data.chapters} />
	<BottomNav />
	<OfflineSetup />
</div>
