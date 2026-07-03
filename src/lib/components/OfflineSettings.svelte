<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { m } from '$lib/paraglide/messages';
	import { dur } from '$lib/motion';
	import Icon from '$lib/components/Icon.svelte';
	import {
		contentSync,
		syncContent,
		clearContent,
		estimateUsage,
		syncPct,
		formatMb,
		type StorageUsage
	} from '$lib/content/sync.svelte';

	// Whole-origin storage estimate, read on mount and after each action so the
	// readout tracks what actually changed.
	let usage = $state<StorageUsage>({ usage: null, quota: null });
	let confirmingClear = $state(false);
	let cleared = $state(false);
	// Set when a re-sync couldn't finish — the offline user (exactly who taps
	// "Check for updates") would otherwise get a silent no-op.
	let failed = $state(false);

	async function refreshUsage() {
		usage = await estimateUsage();
	}

	onMount(refreshUsage);

	// `syncing` is the shared flag from the dedupe wrapper, so a sync started
	// anywhere (first-run, load-time gap fill) is reflected here too — the panel
	// can't show idle while a background run is live.
	const busy = $derived(contentSync.syncing || contentSync.clearing);
	// A real download shows the byte percentage; a quiet verify (no packs
	// downloading) just reads "Checking…".
	const busyLabel = $derived(
		contentSync.downloading ? m.offline_downloading({ pct: syncPct() }) : m.offline_verifying()
	);
	const usedMb = $derived(usage.usage != null ? formatMb(usage.usage) : null);

	async function resync() {
		cleared = false;
		failed = false;
		try {
			await syncContent();
			await refreshUsage();
		} catch {
			// Manifest/pack fetch rejected (typically offline) — syncContent leaves
			// `installed` untouched; surface it so the tap isn't a silent no-op.
			failed = true;
		}
	}

	async function clear() {
		confirmingClear = false;
		failed = false;
		await clearContent();
		cleared = true;
		await refreshUsage();
	}
</script>

<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
	<h2
		class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
	>
		{m.settings_offline()}
	</h2>
	<div class="px-5 py-4">
		<p class="text-faint mb-4 text-xs leading-relaxed">{m.settings_offline_hint()}</p>
		<div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-8">
			<div role="status" aria-live="polite">
				<h3 class="text-ink flex items-center gap-1.5 text-sm font-medium">
					{#if contentSync.installed}
						<Icon name="check" size={15} class="text-accent shrink-0" />
						{m.offline_installed()}
					{:else}
						{m.offline_not_installed()}
					{/if}
				</h3>
				<p class="text-faint mt-0.5 text-xs leading-relaxed">
					{#if busy}
						{busyLabel}
					{:else if usedMb != null}
						{m.offline_storage_used({ size: usedMb })}
					{:else}
						{m.offline_storage_unknown()}
					{/if}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2 sm:justify-end">
				<button
					type="button"
					class="bg-paper text-body hover:border-faint flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
					disabled={busy}
					onclick={resync}
				>
					{#if busy}
						<Icon name="spinner" size={14} class="animate-spin shrink-0" />
						{busyLabel}
					{:else}
						<Icon name="book" size={14} class="shrink-0" />
						{m.offline_resync()}
					{/if}
				</button>

				{#if confirmingClear}
					<span class="flex items-center gap-1" transition:fly={{ x: 4, duration: dur(120) }}>
						<button
							type="button"
							class="bg-paper text-body hover:border-faint rounded-lg border border-edge px-3 py-2 text-sm font-medium transition-colors"
							onclick={() => (confirmingClear = false)}
						>
							{m.offline_clear_cancel()}
						</button>
						<button
							type="button"
							class="rounded-lg border border-edge px-3 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-edge-soft disabled:opacity-60"
							disabled={busy}
							onclick={clear}
						>
							{m.offline_clear_confirm()}
						</button>
					</span>
				{:else}
					<button
						type="button"
						class="text-faint hover:bg-edge-soft hover:text-body rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
						disabled={busy || !contentSync.installed}
						onclick={() => (confirmingClear = true)}
					>
						{m.offline_clear()}
					</button>
				{/if}
			</div>
		</div>

		{#if failed}
			<p
				class="mt-3 text-xs text-red-500"
				role="status"
				aria-live="polite"
				transition:fly={{ y: -4, duration: dur(120) }}
			>
				{m.offline_error()}
			</p>
		{:else if cleared}
			<p
				class="text-faint mt-3 text-xs"
				role="status"
				aria-live="polite"
				transition:fly={{ y: -4, duration: dur(120) }}
			>
				{m.offline_cleared()}
			</p>
		{/if}
	</div>
</section>
