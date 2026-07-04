<script lang="ts">
	import { fade } from 'svelte/transition';
	import { afterNavigate, goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { dur } from '$lib/motion';
	import { app } from '$lib/app-state.svelte';
	import { player } from '$lib/player.svelte';
	import { getSurah } from '$lib/quran/data';
	import { chapterName } from '$lib/quran/locale';
	import { wordHighlight } from '$lib/word-highlight.svelte';
	import type { SurahData, Verse } from '$lib/quran/types';
	import { m } from '$lib/paraglide/messages';
	import Icon from '$lib/components/Icon.svelte';
	import InfoPane from '$lib/components/InfoPane.svelte';
	import Minimap from '$lib/components/Minimap.svelte';
	import SelectionPopover from '$lib/components/SelectionPopover.svelte';
	import VerseCard from '$lib/components/VerseCard.svelte';
	import VerseFlow from '$lib/components/VerseFlow.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const chapter = $derived(data.chapters[data.surah - 1]);
	const prev = $derived(chapter.number > 1 ? data.chapters[chapter.number - 2] : null);
	const next = $derived(chapter.number < 114 ? data.chapters[chapter.number] : null);

	// Whole-surah playback state for the header button. `isThisContinuous`
	// drives both the pressed styling and aria-pressed so they always agree;
	// `surahSounding` (continuous + this surah + actually playing) is the only
	// state that shows the pause glyph — a single ayah of this surah reads as
	// idle play. `surahLoading` covers the window after a tap where continuous +
	// current are set synchronously but the seek hasn't landed yet: show a
	// spinner (like the pill) rather than a premature "Resume".
	const isThisContinuous = $derived(player.continuous && player.current?.surah === data.surah);
	const surahLoading = $derived(isThisContinuous && player.loading);
	const surahSounding = $derived(isThisContinuous && player.playing);

	const skeletonRows = Array.from({ length: 6 }, (_, i) => i);

	// On the server the load awaited the data; on client navigation it hands
	// us a promise so the page renders immediately with skeleton verses.
	let resolved = $state<SurahData | null>(null);
	const surahData = $derived(
		data.surahData instanceof Promise
			? resolved?.surah === data.surah
				? resolved
				: null
			: data.surahData
	);

	$effect(() => {
		const incoming = data.surahData;
		if (!(incoming instanceof Promise)) return;
		let cancelled = false;
		incoming.then((surah) => {
			if (!cancelled) resolved = surah;
		});
		return () => {
			cancelled = true;
		};
	});

	// Focus mode groups verses into one block per mushaf page so the browser
	// can skip shaping/layout of off-screen pages (content-visibility) — one
	// surah-length paragraph forced a full synchronous shape of every word on
	// navigation and reflowed entirely whenever a verse hydrated mid-scroll.
	const versePages = $derived.by(() => {
		const pages: { page: number; verses: Verse[] }[] = [];
		for (const verse of surahData?.verses ?? []) {
			const last = pages[pages.length - 1];
			if (last?.page === verse.page) last.verses.push(verse);
			else pages.push({ page: verse.page, verses: [verse] });
		}
		return pages;
	});

	// Keyboard jumps ([ / ]) get no hover preload — warm the neighbors so
	// they always land from memory, ahead of the slow full-sweep prefetch.
	// Debounced so rapid [ ] traversal doesn't fetch+parse surahs skipped past.
	$effect(() => {
		const n = data.surah;
		const timer = setTimeout(() => {
			if (n < 114) void getSurah(fetch, n + 1);
			if (n > 1) void getSurah(fetch, n - 1);
		}, 250);
		return () => clearTimeout(timer);
	});

	// Warm this surah's recitation (timings + audio metadata) so the first
	// press of Play starts near-instantly. Tracks the reciter preference too.
	$effect(() => {
		const n = data.surah;
		void app.prefs.reciter;
		const timer = setTimeout(() => player.warm(n), 400);
		return () => clearTimeout(timer);
	});

	let main: HTMLElement;

	// The reader scrolls inside <main>, not the window, so handle scroll
	// reset / hash anchors ourselves on navigation.
	afterNavigate(({ to }) => {
		const hash = to?.url.hash?.slice(1);
		const target = hash ? document.getElementById(hash) : null;
		if (target) target.scrollIntoView();
		else main.scrollTop = 0;
	});

	// Honor a hash anchor once the verses exist (skeleton can't resolve it).
	$effect(() => {
		if (!surahData) return;
		const hash = location.hash.slice(1);
		const target = hash ? document.getElementById(hash) : null;
		if (target) target.scrollIntoView();
	});

	// Track the topmost visible verse as progress.
	$effect(() => {
		if (!surahData) return;
		void app.prefs.focusMode; // re-attach when the verse DOM swaps
		const surah = surahData.surah;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- observer bookkeeping only, never rendered
		const visible = new Set<number>();
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const n = Number((entry.target as HTMLElement).dataset.verse);
					if (entry.isIntersecting) {
						visible.add(n);
						app.recordRead(surah, n);
					} else visible.delete(n);
				}
				if (visible.size) app.setLastRead(surah, Math.min(...visible));
			},
			{ root: main, rootMargin: '0px 0px -40% 0px' }
		);
		for (const node of main.querySelectorAll('[data-verse]')) observer.observe(node);
		return () => observer.disconnect();
	});

	// Keep the verse being recited in view during follow-along playback —
	// but only scroll when it actually drifts out of the comfortable band,
	// otherwise constant re-centering makes the whole layout feel jittery.
	$effect(() => {
		if (!player.playing || player.current?.surah !== data.surah) return;
		const el = document.getElementById(`v${player.current.verse}`);
		if (!el) return;
		const box = main.getBoundingClientRect();
		const rect = el.getBoundingClientRect();
		const inView = rect.top >= box.top && rect.top <= box.top + box.height * 0.7;
		if (!inView) el.scrollIntoView({ block: 'center', behavior: dur(1) ? 'smooth' : 'auto' });
	});

	// Tapping a word opens (pins) its translation popover; on devices with a
	// mouse, hovering previews it. The Arabic text is unselectable, so words
	// act as plain tap targets instead of fighting native text selection.
	interface WordSelection {
		verse: Verse;
		from: number;
		to: number;
		x: number;
		top: number;
		bottom: number;
		pinned: boolean;
	}

	let selection = $state<WordSelection | null>(null);

	type WordHit = { verse: Verse; word: number; el: Element };

	function wordAt(target: EventTarget | null): WordHit | null {
		if (!surahData || !(target instanceof Element)) return null;
		const el = target.closest('[data-word]');
		const verseEl = el?.closest<HTMLElement>('[data-verse]');
		if (!el || !verseEl) return null;
		const verse = surahData.verses[Number(verseEl.dataset.verse) - 1];
		return { verse, word: Number((el as HTMLElement).dataset.word), el };
	}

	function selectWord(hit: WordHit, pinned: boolean) {
		const rect = hit.el.getBoundingClientRect();
		selection = {
			verse: hit.verse,
			from: hit.word,
			to: hit.word,
			x: rect.left + rect.width / 2,
			top: rect.top,
			bottom: rect.bottom,
			pinned
		};
	}

	function selectRange(verse: Verse, from: number, to: number) {
		const spans = [
			...main.querySelectorAll<HTMLElement>(`[data-verse="${verse.n}"] [data-word]`)
		].filter((span) => {
			const word = Number(span.dataset.word);
			return word >= from && word <= to;
		});
		if (!spans.length) return;
		const rects = spans.map((span) => span.getBoundingClientRect());
		selection = {
			verse,
			from,
			to,
			x: (Math.min(...rects.map((r) => r.left)) + Math.max(...rects.map((r) => r.right))) / 2,
			top: Math.min(...rects.map((r) => r.top)),
			bottom: Math.max(...rects.map((r) => r.bottom)),
			pinned: true
		};
	}

	// The word pills mirror whatever the popover shows; a live drag takes over
	// the highlight imperatively until it lands in `selection`.
	$effect(() => {
		wordHighlight.range = selection
			? { surah: data.surah, verse: selection.verse.n, from: selection.from, to: selection.to }
			: null;
	});

	// Dragging across words (mouse) or long-press then drag (touch) selects a
	// word range — our own highlight, never native text selection.
	let drag: { verse: Verse; anchor: number; to: number; touch: boolean } | null = null;
	let dragMoved = false;
	let suppressClick = false;
	let longPress: ReturnType<typeof setTimeout> | undefined;
	let press: { x: number; y: number; hit: WordHit } | null = null;

	const blockTouchScroll = (event: TouchEvent) => event.preventDefault();

	function dragRange(): { from: number; to: number } {
		return {
			from: Math.min(drag!.anchor, drag!.to),
			to: Math.max(drag!.anchor, drag!.to)
		};
	}

	function beginTouchRange(hit: WordHit) {
		press = null;
		drag = { verse: hit.verse, anchor: hit.word, to: hit.word, touch: true };
		dragMoved = true;
		wordHighlight.range = { surah: data.surah, verse: hit.verse.n, from: hit.word, to: hit.word };
		main.addEventListener('touchmove', blockTouchScroll, { passive: false });
		navigator.vibrate?.(15);
	}

	function cancelPress() {
		clearTimeout(longPress);
		press = null;
	}

	function endDrag() {
		main.removeEventListener('touchmove', blockTouchScroll);
		if (drag && dragMoved && !selection?.pinned) wordHighlight.range = null;
		drag = null;
		dragMoved = false;
	}

	function onMainPointerDown(event: PointerEvent) {
		suppressClick = false;
		const hit = wordAt(event.target);
		if (!hit) return;
		if (event.pointerType === 'mouse') {
			if (event.button !== 0) return;
			drag = { verse: hit.verse, anchor: hit.word, to: hit.word, touch: false };
			dragMoved = false;
		} else {
			press = { x: event.clientX, y: event.clientY, hit };
			clearTimeout(longPress);
			longPress = setTimeout(() => beginTouchRange(hit), 450);
		}
	}

	function onMainPointerMove(event: PointerEvent) {
		if (press) {
			if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 12) cancelPress();
			return;
		}
		if (!drag) return;
		const hit = wordAt(document.elementFromPoint(event.clientX, event.clientY));
		if (!hit || hit.verse !== drag.verse || hit.word === drag.to) return;
		drag.to = hit.word;
		if (!drag.touch && !dragMoved && hit.word !== drag.anchor) {
			dragMoved = true;
			if (!selection?.pinned) selection = null;
			// Capture so the drag survives the pointer leaving <main>; the
			// synthetic click this retargets is suppressed on pointerup anyway.
			main.setPointerCapture(event.pointerId);
		}
		if (dragMoved) {
			wordHighlight.range = { surah: data.surah, verse: drag.verse.n, ...dragRange() };
		}
	}

	function onMainPointerUp() {
		cancelPress();
		if (!drag) return;
		if (dragMoved) {
			const { from, to } = dragRange();
			suppressClick = true;
			selectRange(drag.verse, from, to);
		}
		endDrag();
	}

	function onMainPointerCancel() {
		cancelPress();
		endDrag();
	}

	function onMainContextMenu(event: MouseEvent) {
		if (press || drag?.touch) event.preventDefault();
	}

	function onMainClick(event: MouseEvent) {
		if (suppressClick) {
			suppressClick = false;
			return;
		}
		const hit = wordAt(event.target);
		if (!hit) {
			selection = null;
			return;
		}
		const samePinnedWord =
			selection?.pinned && selection.verse === hit.verse && selection.from === hit.word;
		if (samePinnedWord) selection = null;
		else selectWord(hit, true);
	}

	function onMainPointerOver(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || selection?.pinned || drag) return;
		const hit = wordAt(event.target);
		if (hit) selectWord(hit, false);
	}

	// The card carries an invisible bridge over the gap to the word, so a
	// pointer heading into it never reads as "outside" — no close delay needed.
	// Leaving toward another word keeps the card mounted; the pointerover that
	// follows retargets it in place instead of blinking it closed and open.
	function onMainPointerOut(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || !wordAt(event.target)) return;
		if (!selection || selection.pinned) return;
		const into = event.relatedTarget as Element | null;
		if (into?.closest?.('[role="tooltip"]') || wordAt(into)) return;
		selection = null;
	}

	function onPopoverPointerLeave(event: PointerEvent) {
		if (event.pointerType !== 'mouse' || !selection || selection.pinned) return;
		const hit = wordAt(event.relatedTarget);
		if (hit && hit.verse === selection.verse && hit.word === selection.from) return;
		selection = null;
	}

	// j/k (or arrows) move keyboard focus between verses.
	function onMainKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('input, textarea, [role="menu"]')) return;
		const down = event.key === 'j' || event.key === 'ArrowDown';
		const up = event.key === 'k' || event.key === 'ArrowUp';
		if (!down && !up) return;
		const articles = [...main.querySelectorAll<HTMLElement>('[data-verse]')];
		if (!articles.length) return;
		const current = (event.target as HTMLElement).closest<HTMLElement>('[data-verse]');
		const index = current ? articles.indexOf(current) : -1;
		const next = articles[down ? Math.min(index + 1, articles.length - 1) : Math.max(index - 1, 0)];
		next?.focus({ preventScroll: true });
		next?.scrollIntoView({ block: 'center', behavior: dur(1) ? 'smooth' : 'auto' });
		event.preventDefault();
	}

	// [ and ] jump to the previous / next surah from anywhere on the page.
	function onWindowKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest?.('input, textarea, [role="menu"]')) return;
		if (event.key === ']' && next) {
			event.preventDefault();
			void goto(resolve('/surah/[surah]', { surah: String(next.number) }));
		} else if (event.key === '[' && prev) {
			event.preventDefault();
			void goto(resolve('/surah/[surah]', { surah: String(prev.number) }));
		}
	}

	function toggleFocus() {
		app.prefs.focusMode = !app.prefs.focusMode;
		app.persistPrefs();
	}

	// Whole-surah play/pause. Paused or playing continuous session for THIS
	// surah → pause/resume in place (word-accurate, no reseek). Otherwise start
	// a fresh continuous recitation. Resume verse, in priority order: the live
	// position if it's this surah → the topmost verse the reader is looking at
	// → the top. surahProgress is deliberately not a source — it's a high-water
	// mark and would fling the reader past where they are.
	function toggleSurah() {
		// Load window: continuous/current are set synchronously by play() but the
		// seek hasn't landed. Ignore the tap — togglePause() here would start audio
		// from the un-seeked position, racing the in-flight seek. The spinner tells
		// the user it's already working.
		if (surahLoading) return;
		if (isThisContinuous) {
			player.togglePause();
			return;
		}
		const start =
			player.current?.surah === data.surah
				? player.current.verse
				: app.lastRead?.surah === data.surah
					? app.lastRead.verse
					: 1;
		void player.play(data.surah, start, { continuous: true });
	}
</script>

<svelte:head>
	<title>{chapter.nameSimple} · Tadabbur</title>
</svelte:head>

<svelte:window onkeydown={onWindowKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main
	bind:this={main}
	id="main-content"
	data-pane
	tabindex="-1"
	class="min-w-0 grow overflow-y-auto focus:outline-none md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden"
	onclick={onMainClick}
	onpointerdown={onMainPointerDown}
	onpointermove={onMainPointerMove}
	onpointerup={onMainPointerUp}
	onpointercancel={onMainPointerCancel}
	onpointerover={onMainPointerOver}
	onpointerout={onMainPointerOut}
	oncontextmenu={onMainContextMenu}
	onscroll={() => (selection = null)}
	onkeydown={onMainKeydown}
>
	<Minimap surah={data.surah} loaded={!!surahData} />
	<div class="mx-auto max-w-3xl px-4 pb-24 sm:px-6 lg:px-10">
		<header class="flex items-start justify-between gap-4 pt-8 pb-6 sm:pt-10">
			<div class="min-w-0">
				<h1 class="text-ink text-xl font-semibold tracking-tight sm:text-2xl">
					{chapter.nameSimple}
				</h1>
				{#if !app.prefs.focusMode}
					<p class="text-faint mt-1 text-sm">
						{chapterName(chapter)} · {m.verses_count({ count: chapter.versesCount })} ·
						{chapter.revelationPlace === 'makkah' ? m.makkah() : m.madinah()}
					</p>
				{/if}
			</div>
			<div class="flex shrink-0 items-center gap-1">
				<button
					type="button"
					class="rounded-lg p-2 transition-colors
						{isThisContinuous ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-edge-soft hover:text-body'}"
					title={surahSounding
						? m.pause()
						: surahLoading
							? m.play_surah()
							: isThisContinuous
								? m.resume()
								: m.play_surah()}
					aria-label={surahSounding
						? m.pause()
						: surahLoading
							? m.play_surah()
							: isThisContinuous
								? m.resume()
								: m.play_surah()}
					aria-pressed={isThisContinuous}
					onclick={toggleSurah}
				>
					<Icon
						name={surahLoading ? 'spinner' : surahSounding ? 'pause' : 'play'}
						class={surahLoading ? 'animate-spin' : ''}
					/>
				</button>
				<button
					type="button"
					class="rounded-lg p-2 transition-colors
						{app.prefs.focusMode
						? 'bg-accent-soft text-accent'
						: 'text-faint hover:bg-edge-soft hover:text-body'}"
					title={m.focus_mode()}
					aria-label={m.focus_mode()}
					aria-pressed={app.prefs.focusMode}
					onclick={toggleFocus}
				>
					<Icon name="focus" />
				</button>
				{#if !app.prefs.infoOpen && !app.prefs.focusMode}
					<button
						type="button"
						class="text-faint hover:bg-edge-soft hover:text-body hidden rounded-lg p-2 transition-colors xl:block"
						title={m.show_info()}
						aria-label={m.show_info()}
						onclick={() => {
							app.prefs.infoOpen = true;
							app.persistPrefs();
						}}
					>
						<Icon name="panel" />
					</button>
				{/if}
			</div>
		</header>

		{#if chapter.bismillahPre}
			<p
				dir="rtl"
				lang="ar"
				class="font-arabic border-edge-soft text-ink border-y py-6 text-center text-3xl select-none"
			>
				بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ
			</p>
		{/if}

		{#if surahData}
			<!-- No transition here on purpose: [ / ] surah jumps must feel instant. -->
			<div in:fade={{ duration: dur(120) }}>
				{#if app.prefs.focusMode}
					<div class="py-6">
						{#each versePages as group (group.page)}
							<p
								dir="rtl"
								lang="ar"
								class="font-arabic text-ink verse-page leading-loose select-none"
								style="font-size: var(--arabic-size)"
							>
								{#each group.verses as verse (verse.key)}<VerseFlow
										surah={surahData.surah}
										{verse}
									/>
								{/each}
							</p>
						{/each}
					</div>
				{:else}
					{#each surahData.verses as verse (verse.key)}
						<VerseCard surah={surahData.surah} {verse} />
					{/each}
				{/if}
			</div>
		{:else}
			{#each skeletonRows as i (i)}
				<div class="border-edge-soft animate-pulse border-b py-6">
					<div class="bg-edge-soft h-10 w-full rounded-lg"></div>
					<div class="bg-edge-soft mt-4 h-4 w-4/5 rounded"></div>
					<div class="bg-edge-soft mt-2 h-4 w-3/5 rounded"></div>
				</div>
			{/each}
		{/if}

		<nav class="mt-10 flex items-center justify-between gap-4">
			{#if prev}
				<a
					href={resolve('/surah/[surah]', { surah: String(prev.number) })}
					class="bg-surface text-body hover:border-accent hover:text-accent flex items-center gap-2 rounded-xl border border-edge px-4 py-3 text-sm font-medium transition-colors"
				>
					<Icon name="chevron-left" size={16} />
					{prev.number}. {prev.nameSimple}
				</a>
			{:else}
				<span></span>
			{/if}
			{#if next}
				<a
					href={resolve('/surah/[surah]', { surah: String(next.number) })}
					class="bg-surface text-body hover:border-accent hover:text-accent flex items-center gap-2 rounded-xl border border-edge px-4 py-3 text-sm font-medium transition-colors"
				>
					{next.number}. {next.nameSimple}
					<Icon name="chevron-right" size={16} />
				</a>
			{/if}
		</nav>
	</div>
</main>

{#if selection}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div onpointerleave={onPopoverPointerLeave}>
		<SelectionPopover
			surah={data.surah}
			verse={selection.verse}
			from={selection.from}
			to={selection.to}
			x={selection.x}
			top={selection.top}
			bottom={selection.bottom}
		/>
	</div>
{/if}

{#if surahData && app.prefs.infoOpen && !app.prefs.focusMode}
	<InfoPane {chapter} {surahData} />
{/if}
