<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { app, type SidebarView } from '$lib/app-state.svelte';
	import { m } from '$lib/paraglide/messages';
	import Icon from './Icon.svelte';

	const items: { view: SidebarView; icon: string; label: () => string }[] = [
		{ view: 'surahs', icon: 'book', label: m.nav_surahs },
		{ view: 'search', icon: 'search', label: m.nav_search },
		{ view: 'notes', icon: 'note', label: m.nav_notes },
		{ view: 'progress', icon: 'chart', label: m.nav_progress }
	];

	function itemClass(view: SidebarView): string {
		const active = app.view === view && (app.prefs.sidebarOpen || app.mobileSidebarOpen);
		return active ? 'bg-accent-soft text-accent' : 'text-faint hover:bg-edge-soft hover:text-body';
	}
</script>

<nav
	data-pane
	class="bg-paper z-40 hidden w-12 shrink-0 flex-col items-center gap-1 border-r border-edge py-3 md:flex"
	aria-label="Primary"
>
	<a
		href={resolve('/')}
		class="text-accent mb-2 flex h-9 w-9 items-center justify-center rounded-lg no-hover:h-11 no-hover:w-11"
		title={m.nav_home()}
	>
		<span class="font-arabic text-2xl leading-none">ت</span>
	</a>

	{#each items as item (item.view)}
		<button
			type="button"
			class="flex h-9 w-9 items-center justify-center rounded-lg no-hover:h-11 no-hover:w-11 transition-colors {itemClass(
				item.view
			)}"
			title={item.label()}
			aria-label={item.label()}
			onclick={() => app.toggleSidebar(item.view)}
		>
			<Icon name={item.icon} />
		</button>
	{/each}

	<div class="grow"></div>

	<a
		href={resolve('/settings')}
		class="flex h-9 w-9 items-center justify-center rounded-lg no-hover:h-11 no-hover:w-11 transition-colors {page
			.url.pathname === '/settings'
			? 'bg-accent-soft text-accent'
			: 'text-faint hover:bg-edge-soft hover:text-body'}"
		title={m.nav_settings()}
		aria-label={m.nav_settings()}
	>
		<Icon name="settings" />
	</a>
</nav>
