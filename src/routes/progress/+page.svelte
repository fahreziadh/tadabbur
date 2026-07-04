<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import ProgressView from '$lib/components/ProgressView.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>{m.nav_progress()} · Tadabbur</title>
</svelte:head>

<main
	id="main-content"
	data-pane
	tabindex="-1"
	class="min-w-0 grow overflow-y-auto focus:outline-none"
>
	<div class="mx-auto max-w-md pt-8 pb-24 sm:pt-10">
		<h1 class="text-ink px-3 text-xl font-semibold tracking-tight sm:text-2xl">
			{m.nav_progress()}
		</h1>
		<div class="mt-6 flex flex-col">
			<ProgressView chapters={data.chapters} />
		</div>
	</div>
</main>
