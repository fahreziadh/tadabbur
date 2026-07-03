<script lang="ts">
	import { onMount } from 'svelte';
	import { version } from '$app/environment';
	import { m } from '$lib/paraglide/messages';
	import { getLocale } from '$lib/paraglide/runtime';
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

	let usage = $state<StorageUsage>({ usage: null, quota: null });
	let clearDialog: HTMLDialogElement;
	let phase = $state<'idle' | 'checking' | 'updating' | 'current' | 'failed'>('idle');
	let updateApplying = false;

	const builtAt = Number(version);
	const builtLabel = Number.isFinite(builtAt)
		? new Date(builtAt).toLocaleString(getLocale(), {
				day: 'numeric',
				month: 'short',
				year: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			})
		: version;

	async function refreshUsage() {
		usage = await estimateUsage();
	}

	onMount(refreshUsage);

	async function checkAppUpdate(): Promise<boolean> {
		const reg =
			'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
		if (!reg) return false;
		await reg.update();
		const incoming = reg.installing ?? reg.waiting;
		if (!incoming) return false;
		updateApplying = true;
		incoming.addEventListener('statechange', () => {
			if (incoming.state === 'activated') location.reload();
			else if (incoming.state === 'redundant') {
				updateApplying = false;
				phase = 'failed';
			}
		});
		return true;
	}

	async function refresh() {
		phase = 'checking';
		try {
			const [updateFound] = await Promise.all([checkAppUpdate(), syncContent()]);
			await refreshUsage();
			phase = updateFound
				? updateApplying
					? 'updating'
					: 'failed'
				: contentSync.installed
					? 'current'
					: 'idle';
		} catch {
			phase = updateApplying ? 'updating' : 'failed';
		}
	}

	async function confirmClear() {
		clearDialog.close();
		phase = 'idle';
		await clearContent();
		await refreshUsage();
	}

	const busy = $derived(
		phase === 'checking' || phase === 'updating' || contentSync.syncing || contentSync.clearing
	);
	const usedMb = $derived(usage.usage != null ? formatMb(usage.usage) : null);
	const ready = $derived(contentSync.installed);

	const heading = $derived(
		phase === 'updating'
			? m.offline_updating_app()
			: contentSync.downloading
				? m.offline_downloading({ pct: syncPct() })
				: busy
					? m.offline_verifying()
					: phase === 'failed'
						? m.offline_error()
						: phase === 'current'
							? m.offline_up_to_date()
							: ready
								? m.offline_ready()
								: m.offline_not_ready()
	);
	const showCheck = $derived(!busy && phase !== 'failed' && ready);
</script>

<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
	<h2
		class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
	>
		{m.settings_offline()}
	</h2>
	<div class="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-8">
		<div role="status" aria-live="polite">
			<h3
				class="flex items-center gap-1.5 text-sm font-medium {phase === 'failed' && !busy
					? 'text-red-500'
					: 'text-ink'}"
			>
				{#if busy}
					<Icon name="spinner" size={15} class="text-faint animate-spin shrink-0" />
				{:else if showCheck}
					<Icon name="check" size={15} class="text-accent shrink-0" />
				{/if}
				{heading}
			</h3>
			<p class="text-faint mt-0.5 text-xs leading-relaxed">
				{ready ? m.offline_desc() : m.offline_desc_get()}
			</p>
		</div>
		<div class="flex items-center sm:justify-end">
			<button
				type="button"
				class="bg-paper text-body hover:border-faint flex items-center gap-1.5 rounded-lg border border-edge px-3 py-2 text-sm font-medium transition-colors disabled:opacity-60"
				disabled={busy}
				onclick={refresh}
			>
				<Icon name={ready ? 'refresh' : 'download'} size={14} class="shrink-0" />
				{ready ? m.offline_resync() : m.offline_download()}
			</button>
		</div>
	</div>
	<div
		class="text-faint flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-edge-soft px-5 py-2.5 text-xs"
	>
		<span>{m.offline_updated_on({ date: builtLabel })}</span>
		{#if ready && usedMb != null}
			<span aria-hidden="true">·</span>
			<span>{m.offline_size_used({ size: usedMb })}</span>
		{/if}
		{#if ready}
			<span aria-hidden="true">·</span>
			<button
				type="button"
				class="underline-offset-2 transition-colors hover:text-red-500 hover:underline disabled:opacity-60"
				disabled={busy}
				onclick={() => clearDialog.showModal()}
			>
				{m.offline_clear()}
			</button>
		{/if}
	</div>
</section>

<dialog
	bind:this={clearDialog}
	onclick={(event) => {
		if (event.target === clearDialog) clearDialog.close();
	}}
	class="bg-surface m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-edge shadow-2xl backdrop:bg-black/50"
>
	<div class="px-5 py-4">
		<h3 class="text-ink text-sm font-semibold">{m.offline_clear_title()}</h3>
		<p class="text-muted mt-1.5 text-xs leading-relaxed">{m.offline_clear_body()}</p>
		<div class="mt-4 flex justify-end gap-2">
			<button
				type="button"
				class="bg-paper text-body hover:border-faint rounded-lg border border-edge px-3 py-2 text-sm font-medium transition-colors"
				onclick={() => clearDialog.close()}
			>
				{m.offline_clear_cancel()}
			</button>
			<button
				type="button"
				class="rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
				onclick={confirmClear}
			>
				{m.offline_clear_confirm()}
			</button>
		</div>
	</div>
</dialog>
