<script lang="ts">
	import { player } from '$lib/player.svelte';
	import { lazyObserve } from '$lib/lazy-cards';
	import { wordHighlight } from '$lib/word-highlight.svelte';
	import type { Verse } from '$lib/quran/types';
	import { arabicVerseNumber } from '$lib/quran/format';
	import { m } from '$lib/paraglide/messages';

	let { surah, verse }: { surah: number; verse: Verse } = $props();

	const highlightActive = $derived(
		player.playing && player.current?.surah === surah && player.current.verse === verse.n
	);
	const activeWord = $derived(highlightActive ? player.currentWord : null);
	const isLoading = $derived(
		player.loading && player.current?.surah === surah && player.current.verse === verse.n
	);

	let nearViewport = $state(false);
	const showWordSpans = $derived(nearViewport || highlightActive);
	const plainText = $derived(verse.words.map((w) => w.a).join(' ') + ' ');

	function onKeydown(event: KeyboardEvent) {
		if (event.metaKey || event.ctrlKey || event.altKey) return;
		if (event.key === 'p') {
			event.preventDefault();
			player.toggle(surah, verse.n);
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
<span
	id="v{verse.n}"
	data-verse={verse.n}
	role="group"
	aria-label={m.verse_aria({ key: verse.key })}
	tabindex="0"
	onkeydown={onKeydown}
	class="verse-anchor rounded select-none focus:outline-none focus-visible:bg-accent-soft [box-decoration-break:clone]"
	{@attach (node) => lazyObserve(node, (visible) => (nearViewport = visible))}
	>{#if showWordSpans}{#each verse.words as word, i (i)}<span
				data-word={i + 1}
				class="cursor-pointer transition-colors duration-100 can-hover:hover:text-accent {activeWord ===
				i + 1
					? 'word-active'
					: ''} {wordHighlight.covers(surah, verse.n, i + 1) ? 'word-selected' : ''}"
				>{word.a + ' '}</span
			>{/each}{:else}{plainText}{/if}<span
		class="text-accent mx-1 inline-block {isLoading ? 'animate-pulse' : ''}"
		style="font-size: calc(var(--arabic-size) * 0.6)">﴿{arabicVerseNumber(verse.n)}﴾</span
	></span
>
