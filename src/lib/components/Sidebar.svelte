<script lang="ts">
	import { fade } from 'svelte/transition';
	import { app } from '$lib/app-state.svelte';
	import { dur } from '$lib/motion';
	import { m } from '$lib/paraglide/messages';
	import type { Chapter } from '$lib/quran/types';
	import SurahList from './SurahList.svelte';
	import SearchView from './SearchView.svelte';
	import NotesView from './NotesView.svelte';
	import ProgressView from './ProgressView.svelte';

	let { chapters }: { chapters: Chapter[] } = $props();

	const titles = {
		surahs: m.nav_surahs,
		search: m.nav_search,
		notes: m.nav_notes,
		progress: m.nav_progress
	} as const;
</script>

<aside data-pane class="bg-paper flex h-full w-72 shrink-0 flex-col border-r border-edge">
	<h2 class="text-faint px-4 pt-4 pb-2 text-xs font-semibold tracking-widest uppercase">
		{titles[app.view]()}
	</h2>

	{#key app.view}
		<div class="flex min-h-0 grow flex-col" in:fade={{ duration: dur(120) }}>
			{#if app.view === 'surahs'}
				<SurahList {chapters} />
			{:else if app.view === 'search'}
				<SearchView {chapters} />
			{:else if app.view === 'notes'}
				<NotesView />
			{:else}
				<ProgressView {chapters} />
			{/if}
		</div>
	{/key}
</aside>
