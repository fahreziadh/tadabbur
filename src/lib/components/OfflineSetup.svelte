<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import { m } from '$lib/paraglide/messages';
	import { contentSync, syncContent, syncPct, formatMb } from '$lib/content/sync.svelte';

	onMount(() => {
		// First-run offline: runSync rejects on the manifest fetch. The splash
		// still closes via runSync's finally; swallow so it isn't an unhandled
		// rejection (the settings re-sync surfaces failures with its own UI).
		void syncContent().catch(() => {});
	});

	const pct = $derived(syncPct());
</script>

{#if contentSync.installing}
	<div
		out:fade={{ duration: dur(300) }}
		class="bg-paper fixed inset-0 z-50 flex items-center justify-center p-6"
		role="status"
		aria-live="polite"
	>
		<div class="w-full max-w-sm text-center">
			<p class="font-arabic text-accent text-5xl">تدبر</p>
			<h1 class="text-ink mt-4 text-xl font-semibold tracking-tight">{m.setup_title()}</h1>
			<p class="text-muted mt-2 text-sm leading-relaxed">{m.setup_body()}</p>
			<div class="bg-edge-soft mt-8 h-1.5 overflow-hidden rounded-full">
				<div
					class="bg-accent h-full rounded-full transition-[width] duration-200 ease-out"
					style:width="{pct}%"
				></div>
			</div>
			<p class="text-faint mt-3 text-xs tabular-nums">
				{#if contentSync.totalBytes}
					{pct}% · {formatMb(contentSync.receivedBytes)} / {formatMb(contentSync.totalBytes)} MB
				{:else}
					&nbsp;
				{/if}
			</p>
		</div>
	</div>
{/if}
