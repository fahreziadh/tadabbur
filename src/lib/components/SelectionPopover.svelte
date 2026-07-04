<script lang="ts">
	import { fly } from 'svelte/transition';
	import { player } from '$lib/player.svelte';
	import { dur } from '$lib/motion';
	import type { Verse } from '$lib/quran/types';
	import { getLocale } from '$lib/paraglide/runtime';
	import { m } from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	let {
		surah,
		verse,
		from,
		to,
		x,
		top,
		bottom
	}: {
		surah: number;
		verse: Verse;
		from: number;
		to: number;
		x: number;
		top: number;
		bottom: number;
	} = $props();

	const words = $derived(verse.words.slice(from - 1, to));
	const locale = getLocale();

	// Anchored above the word by default; shifted back into the viewport when
	// the word sits near an edge, flipped below it when there's no room above.
	let shiftX = $state(0);
	let flipped = $state(false);

	function keepInViewport(node: HTMLElement) {
		const margin = 8;
		const naturalLeft = x - node.offsetWidth / 2;
		const left = Math.min(
			Math.max(naturalLeft, margin),
			window.innerWidth - margin - node.offsetWidth
		);
		shiftX = left - naturalLeft;
		flipped = top - node.offsetHeight - 10 < margin;
	}
</script>

<div
	in:fly={{ y: 6, duration: dur(140) }}
	class="bg-surface fixed z-50 min-w-48 max-w-[calc(100vw-16px)] -translate-x-1/2 rounded-xl border border-edge p-3 shadow-xl sm:max-w-md {flipped
		? ''
		: '-translate-y-full'}"
	style="left: {x + shiftX}px; top: {flipped ? bottom + 10 : top - 10}px"
	role="tooltip"
	{@attach keepInViewport}
>
	<!-- Invisible hover bridge across the gap to the word, so the pointer can
	     travel into the card without ever being outside of it. -->
	<div
		aria-hidden="true"
		class="absolute left-0 h-4 w-full {flipped ? 'bottom-full' : 'top-full'}"
	></div>
	<div dir="rtl" class="flex flex-wrap justify-center gap-x-3 gap-y-2">
		{#each words as word, i (i)}
			<span class="text-center">
				<span class="font-arabic text-ink block text-xl leading-snug">{word.a}</span>
				<span class="text-faint block max-w-24 text-[11px] leading-tight">
					{locale === 'id' ? word.id : word.en}
				</span>
			</span>
		{/each}
	</div>
	<div class="border-edge-soft mt-2.5 flex items-center justify-between border-t pt-2">
		<span class="text-faint text-[11px] font-medium">
			{verse.key} · {from === to ? from : `${from}–${to}`}
		</span>
		<button
			type="button"
			class="bg-accent-soft text-accent flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition-opacity hover:opacity-80"
			onclick={() => player.playWords(surah, verse.n, { from, to })}
		>
			<Icon name="play" size={13} />
			{from === to ? m.play_word() : m.play_selection()}
		</button>
	</div>
</div>
