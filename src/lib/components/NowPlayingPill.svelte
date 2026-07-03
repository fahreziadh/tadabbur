<script lang="ts">
	import { fly } from 'svelte/transition';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { dur } from '$lib/motion';
	import { player } from '$lib/player.svelte';
	import { m } from '$lib/paraglide/messages';
	import type { Chapter } from '$lib/quran/types';
	import Icon from './Icon.svelte';

	let { chapters }: { chapters: Chapter[] } = $props();

	// Surfaces in two cases: recitation sounding (or paused) for a surah that is
	// NOT on screen — a way back to what's playing — OR whole-surah playback of
	// the surah you're reading, so there's a pause control that doesn't scroll
	// off with the header button. A quick single-ayah listen of the on-screen
	// surah stays quiet (its own verse button is right there).
	const now = $derived.by(() => {
		const current = player.current;
		if (!current) return null;
		const onThisSurah = page.params.surah === String(current.surah);
		if (onThisSurah && !player.continuous) return null;
		return {
			...current,
			onThisSurah,
			chapter: chapters[current.surah - 1],
			href: resolve('/surah/[surah]', { surah: String(current.surah) }) + `#v${current.verse}`
		};
	});
</script>

{#if now}
	<div
		class="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 z-40 -translate-x-1/2 md:bottom-[calc(1rem+env(safe-area-inset-bottom))]"
	>
		<div
			transition:fly={{ y: 12, duration: dur(180) }}
			class="bg-surface border-edge flex items-center gap-0.5 rounded-full border p-1 shadow-lg"
		>
			<button
				type="button"
				class="text-body hover:bg-edge-soft hover:text-ink rounded-full p-1.5 transition-colors no-hover:p-2.5"
				title={player.playing ? m.pause() : m.resume()}
				aria-label={player.playing ? m.pause() : m.resume()}
				onclick={() => player.togglePause()}
			>
				<Icon
					name={player.loading ? 'spinner' : player.playing ? 'pause' : 'play'}
					size={16}
					class={player.loading ? 'animate-spin' : ''}
				/>
			</button>
			{#snippet label()}
				{#if player.playing}
					<span class="eq text-accent shrink-0" aria-hidden="true"><i></i><i></i><i></i></span>
				{/if}
				<span class="max-w-52 truncate">
					{now.surah}. {now.chapter.nameSimple} · {m.verse_n({ n: now.verse })}
				</span>
			{/snippet}
			{#if now.onThisSurah}
				<!-- Already on this surah: the follow-along scroll keeps the reciting
				     verse in view, so a link here would only yank the reader. Plain text. -->
				<span class="text-body flex min-w-0 items-center gap-2 py-1 pr-2 pl-1 text-sm font-medium">
					{@render label()}
				</span>
			{:else}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- resolve()d in the derived, plus a #v hash the resolver can't express -->
				<a
					href={now.href}
					class="text-body hover:text-accent flex min-w-0 items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm font-medium transition-colors"
					title={m.now_playing()}
				>
					{@render label()}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
			<button
				type="button"
				class="text-faint hover:bg-edge-soft hover:text-body rounded-full p-1.5 transition-colors no-hover:p-2.5"
				title={m.stop_playback()}
				aria-label={m.stop_playback()}
				onclick={() => player.stop()}
			>
				<Icon name="close" size={14} />
			</button>
		</div>
	</div>
{/if}

<style>
	/* Tiny equalizer — "something is sounding" at a glance. */
	.eq {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 12px;
	}
	.eq i {
		width: 2.5px;
		border-radius: 1px;
		background: currentColor;
		animation: eq 1s ease-in-out infinite;
	}
	.eq i:nth-child(2) {
		animation-delay: 0.25s;
	}
	.eq i:nth-child(3) {
		animation-delay: 0.5s;
	}
	@keyframes eq {
		0%,
		100% {
			height: 4px;
		}
		50% {
			height: 12px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.eq i {
			animation: none;
			height: 8px;
		}
	}
</style>
