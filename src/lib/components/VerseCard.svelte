<script lang="ts">
	import { fly, slide } from 'svelte/transition';
	import { app } from '$lib/app-state.svelte';
	import { player } from '$lib/player.svelte';
	import { dur } from '$lib/motion';
	import { lazyObserve } from '$lib/lazy-cards';
	import type { Verse } from '$lib/quran/types';
	import { verseTranslation } from '$lib/quran/locale';
	import { arabicVerseNumber } from '$lib/quran/format';
	import { m } from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';
	import TafsirPanel from './TafsirPanel.svelte';

	let { surah, verse }: { surah: number; verse: Verse } = $props();

	let tafsirOpen = $state(false);
	let copied = $state(false);
	let recordNote = $state(false);
	let playMenuOpen = $state(false);
	let menuButton: HTMLButtonElement | undefined = $state();

	const isCurrent = $derived(player.current?.surah === surah && player.current.verse === verse.n);
	// The karaoke highlight follows any playback (whole verse or a selected
	// range); the Play/Pause button only reflects whole-verse playback.
	const highlightActive = $derived(player.playing && isCurrent);
	const isPlaying = $derived(highlightActive && !player.rangeActive);
	const isLoading = $derived(player.loading && isCurrent && !player.rangeActive);
	const activeWord = $derived(highlightActive ? player.currentWord : null);

	// Mounting every card in full made surah navigation block for hundreds of
	// ms on long surahs — far cards render plain text (same height) and defer
	// word spans + the actions row until they approach the viewport.
	let nearViewport = $state(false);
	const hydrated = $derived(nearViewport || highlightActive || tafsirOpen || playMenuOpen);
	const plainText = $derived(verse.words.map((w) => w.a).join(' ') + ' ');

	async function copyLink() {
		const url = `${location.origin}/surah/${surah}#v${verse.n}`;
		await navigator.clipboard.writeText(url);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	function record() {
		// Hifz recording is issue #17 — stub until then.
		recordNote = true;
		setTimeout(() => (recordNote = false), 1800);
	}

	// Shortcuts on a focused verse: p play/pause, t tafsir, c copy link.
	function onArticleKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if ((event.target as HTMLElement).closest('[role="menu"], input, textarea')) return;
		if (event.key === 'p') {
			event.preventDefault();
			player.toggle(surah, verse.n);
		} else if (event.key === 't') {
			event.preventDefault();
			tafsirOpen = !tafsirOpen;
		} else if (event.key === 'c') {
			event.preventDefault();
			void copyLink();
		} else if (event.key === 'Escape' && playMenuOpen) {
			playMenuOpen = false;
			menuButton?.focus();
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			playMenuOpen = false;
			menuButton?.focus();
			return;
		}
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
		event.preventDefault();
		const items = [
			...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="menuitem"]')
		];
		const index = items.indexOf(document.activeElement as HTMLElement);
		const step = event.key === 'ArrowDown' ? 1 : -1;
		items[(index + step + items.length) % items.length]?.focus();
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<article
	id="v{verse.n}"
	data-verse={verse.n}
	role="group"
	aria-label={m.verse_aria({ key: verse.key })}
	tabindex="0"
	onkeydown={onArticleKeydown}
	class="verse-anchor verse-card group border-edge-soft border-b py-6 last:border-b-0 {playMenuOpen
		? 'menu-open'
		: ''}"
	{@attach (node) => lazyObserve(node, (visible) => (nearViewport = visible))}
>
	<p
		dir="rtl"
		lang="ar"
		class="font-arabic text-ink leading-loose"
		style="font-size: var(--arabic-size)"
	>
		{#if hydrated}{#each verse.words as word, i (i)}<span
					data-word={i + 1}
					class="transition-colors duration-100 {activeWord === i + 1 ? 'word-active' : ''}"
					>{word.a + ' '}</span
				>{/each}{:else}{plainText}{/if}<span
			class="text-accent mx-1 inline-block"
			style="font-size: calc(var(--arabic-size) * 0.6)">﴿{arabicVerseNumber(verse.n)}﴾</span
		>
	</p>

	{#if !app.prefs.focusMode}
		{@const translation = verseTranslation(verse)}
		{#if translation}
			<p class="text-body mt-3 text-[15px] leading-relaxed">{translation}</p>
		{/if}

		{#if !hydrated}
			<div class="mt-3 h-[26px] no-hover:h-[34px]"></div>
		{:else}
			<div
				class="mt-3 flex flex-wrap items-center gap-1 transition-opacity group-hover:opacity-100 focus-within:opacity-100 can-hover:opacity-0 {tafsirOpen ||
				isPlaying ||
				isLoading ||
				playMenuOpen
					? 'opacity-100'
					: ''}"
			>
				<span class="bg-edge-soft text-faint mr-1 rounded px-1.5 py-0.5 text-xs font-medium">
					{verse.key}
				</span>
				<div class="relative flex items-center">
					<div
						class="flex items-center rounded-md border transition-colors
							{isPlaying || isLoading || playMenuOpen ? 'border-accent/50' : 'border-edge'}"
					>
						<button
							type="button"
							class="flex items-center gap-1 rounded-l-[5px] px-2 py-1 text-xs font-medium transition-colors no-hover:px-2.5 no-hover:py-2
								{isPlaying || isLoading
								? 'bg-accent-soft text-accent'
								: 'text-faint no-hover:text-body hover:bg-edge-soft hover:text-body'}"
							onclick={() => player.toggle(surah, verse.n)}
						>
							<Icon
								name={isLoading ? 'spinner' : isPlaying ? 'pause' : 'play'}
								size={14}
								class={isLoading ? 'animate-spin' : ''}
							/>
							{isPlaying ? m.pause() : m.play()}
						</button>
						<button
							bind:this={menuButton}
							type="button"
							class="flex items-center self-stretch rounded-r-[5px] border-l pr-1 pl-0.5 transition-colors no-hover:pr-2 no-hover:pl-1.5
								{isPlaying || isLoading || playMenuOpen ? 'border-accent/50' : 'border-edge'}
								{playMenuOpen
								? 'bg-accent-soft text-accent'
								: 'text-faint no-hover:text-body hover:bg-edge-soft hover:text-body'}"
							title={m.playback_options()}
							aria-label={m.playback_options()}
							aria-haspopup="menu"
							aria-expanded={playMenuOpen}
							onclick={() => (playMenuOpen = !playMenuOpen)}
						>
							<Icon name="chevron-down" size={12} />
						</button>
					</div>
					{#if playMenuOpen}
						<button
							type="button"
							tabindex="-1"
							class="fixed inset-0 z-20 cursor-default"
							aria-hidden="true"
							onclick={() => (playMenuOpen = false)}
						></button>
						<div
							transition:fly={{ y: -4, duration: dur(120) }}
							class="bg-surface absolute top-full left-0 z-30 mt-1 w-52 rounded-lg border border-edge py-1 shadow-lg"
							role="menu"
							tabindex="-1"
							onkeydown={onMenuKeydown}
							{@attach (node) => {
								node.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
							}}
						>
							<button
								type="button"
								role="menuitem"
								class="text-body hover:bg-edge-soft flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium no-hover:py-2.5"
								onclick={() => {
									playMenuOpen = false;
									void player.play(surah, verse.n);
								}}
							>
								<Icon name="play" size={13} />
								{m.play_this_ayah()}
							</button>
							<button
								type="button"
								role="menuitem"
								class="text-body hover:bg-edge-soft flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-medium no-hover:py-2.5"
								onclick={() => {
									playMenuOpen = false;
									void player.play(surah, verse.n, { continuous: true });
								}}
							>
								<Icon name="chevron-right" size={13} />
								{m.play_from_here()}
							</button>
						</div>
					{/if}
				</div>
				<button
					type="button"
					class="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors no-hover:px-2.5 no-hover:py-2
						{tafsirOpen
						? 'bg-accent-soft text-accent'
						: 'text-faint no-hover:text-body hover:bg-edge-soft hover:text-body'}"
					onclick={() => (tafsirOpen = !tafsirOpen)}
				>
					<Icon name="book" size={14} />
					{m.tafsir()}
				</button>
				<button
					type="button"
					class="text-faint no-hover:text-body hover:bg-edge-soft hover:text-body flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors no-hover:px-2.5 no-hover:py-2"
					onclick={copyLink}
				>
					<Icon name="link" size={14} />
					{copied ? m.copied() : m.copy_link()}
				</button>
				<button
					type="button"
					class="text-faint no-hover:text-body hover:bg-edge-soft hover:text-body flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors no-hover:px-2.5 no-hover:py-2"
					onclick={record}
				>
					<Icon name="mic" size={14} />
					{recordNote ? m.coming_soon() : m.record()}
				</button>
			</div>

			{#if tafsirOpen}
				<div transition:slide={{ duration: dur(200) }}>
					<TafsirPanel {surah} verse={verse.n} />
				</div>
			{/if}
		{/if}
	{/if}
</article>
