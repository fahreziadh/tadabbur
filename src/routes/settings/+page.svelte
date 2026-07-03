<script lang="ts">
	import {
		app,
		arabicFontStacks,
		themes,
		type ArabicFont,
		type Theme
	} from '$lib/app-state.svelte';
	import { reciters, type ReciterId } from '$lib/quran/audio';
	import { getTimings } from '$lib/quran/timings';
	import { player } from '$lib/player.svelte';
	import { m } from '$lib/paraglide/messages';
	import { resolve } from '$app/paths';
	import { getLocale, setLocale, type Locale } from '$lib/paraglide/runtime';
	import { fly } from 'svelte/transition';
	import { dur } from '$lib/motion';
	import Icon from '$lib/components/Icon.svelte';
	import Segmented from '$lib/components/Segmented.svelte';
	import OfflineSettings from '$lib/components/OfflineSettings.svelte';

	const themeLabels: Record<Theme, () => string> = {
		light: m.theme_light,
		dark: m.theme_dark,
		mushaf: m.theme_mushaf,
		rawdah: m.theme_rawdah,
		sea: m.theme_sea,
		night: m.theme_night
	};

	const fontOptions: { value: ArabicFont; label: string }[] = [
		{ value: 'uthmani', label: 'KFGQPC Uthmanic Hafs — Madinah Mushaf' },
		{ value: 'amiri', label: 'Amiri Quran' },
		{ value: 'scheherazade', label: 'Scheherazade New' },
		{ value: 'noto', label: 'Noto Naskh Arabic' }
	];

	function setPref<K extends 'theme' | 'arabicFont' | 'reciter'>(
		key: K,
		value: (typeof app.prefs)[K]
	) {
		app.prefs[key] = value;
		app.persistPrefs();
	}

	/**
	 * Reciter preview: plays that reciter's bismillah (Al-Fatihah 1:1) from
	 * the same gapless surah MP3 + timings the main player uses.
	 */
	let previewId = $state<ReciterId | null>(null); // actively playing
	let previewPending = $state<ReciterId | null>(null); // fetching/seeking
	let previewAudio: HTMLAudioElement | null = null;
	let previewEndMs = 0;

	function ensurePreviewAudio(): HTMLAudioElement {
		if (!previewAudio) {
			previewAudio = new Audio();
			previewAudio.addEventListener('timeupdate', () => {
				if (previewAudio!.currentTime * 1000 >= previewEndMs) previewAudio!.pause();
			});
			previewAudio.addEventListener('pause', () => (previewId = null));
		}
		return previewAudio;
	}

	async function togglePreview(id: ReciterId) {
		if (previewId === id || previewPending === id) {
			previewAudio?.pause();
			previewPending = null;
			return;
		}
		previewPending = id;
		const audio = ensurePreviewAudio();
		audio.pause();
		try {
			const timings = await getTimings(id, 1);
			if (previewPending !== id) return;
			const verse = timings.verses[0];
			player.stop(); // never layer the sample over main playback
			audio.src = timings.audioUrl;
			await new Promise<void>((resolve) => {
				if (audio.readyState >= 1) resolve();
				else audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
			});
			if (previewPending !== id) return;
			previewEndMs = verse.to;
			audio.currentTime = verse.from / 1000;
			await audio.play();
			previewId = id;
		} catch {
			/* CDN hiccup — leave the row idle */
		} finally {
			if (previewPending === id) previewPending = null;
		}
	}

	$effect(() => {
		return () => previewAudio?.pause();
	});

	/** Custom reciter dropdown — native <select> can't host preview buttons. */
	let reciterOpen = $state(false);
	let reciterMenu: HTMLDivElement | undefined = $state();
	const currentReciter = $derived(reciters.find((r) => r.id === app.prefs.reciter) ?? reciters[0]);

	$effect(() => {
		if (!reciterOpen) return;
		const onPointerDown = (event: PointerEvent) => {
			if (!reciterMenu?.contains(event.target as Node)) reciterOpen = false;
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') reciterOpen = false;
		};
		window.addEventListener('pointerdown', onPointerDown);
		window.addEventListener('keydown', onKeyDown);
		return () => {
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
			// Closing the menu also ends any running sample.
			previewAudio?.pause();
			previewPending = null;
		};
	});

	const shortcuts = [
		{ keys: ['Ctrl/⌘', 'B'], label: m.sc_toggle_sidebar },
		{ keys: ['Ctrl/⌘', 'F'], label: m.sc_search },
		{ keys: ['J', 'K'], label: m.sc_verse_nav },
		{ keys: ['[', ']'], label: m.sc_surah_nav },
		{ keys: ['P'], label: m.sc_play },
		{ keys: ['T'], label: m.sc_tafsir },
		{ keys: ['C'], label: m.sc_copy },
		{ keys: ['1–4', 'F6'], label: m.sc_panes },
		{ keys: ['Esc'], label: m.sc_close }
	];
</script>

<svelte:head>
	<title>{m.nav_settings()} · Tadabbur</title>
</svelte:head>

<main
	id="main-content"
	data-pane
	tabindex="-1"
	class="min-w-0 grow overflow-y-auto focus:outline-none"
>
	<div class="mx-auto max-w-3xl px-4 pt-8 pb-24 sm:px-6 sm:pt-10 lg:px-10">
		<h1 class="text-ink text-xl font-semibold tracking-tight sm:text-2xl">{m.nav_settings()}</h1>
		<p class="text-muted mt-1 max-w-xl text-sm leading-relaxed">{m.settings_note()}</p>

		<div class="mt-8 flex flex-col gap-6">
			<!-- General: language + reciter, label-left / control-right rows.
			     No overflow-hidden here: it would clip the reciter dropdown. -->
			<section class="bg-surface rounded-2xl border border-edge">
				<h2
					class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
				>
					{m.settings_general()}
				</h2>
				<div class="divide-y divide-edge-soft">
					<div
						class="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-8"
					>
						<div>
							<h3 class="text-ink text-sm font-medium">{m.settings_language()}</h3>
							<p class="text-faint mt-0.5 text-xs leading-relaxed">{m.settings_language_hint()}</p>
						</div>
						<Segmented
							options={[
								{ value: 'en', label: 'English' },
								{ value: 'id', label: 'Indonesia' }
							]}
							value={getLocale()}
							onselect={(value) => setLocale(value as Locale)}
						/>
					</div>

					<div
						class="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center sm:gap-8"
					>
						<div>
							<h3 class="text-ink text-sm font-medium">{m.settings_reciter()}</h3>
							<p class="text-faint mt-0.5 text-xs leading-relaxed">{m.settings_reciter_hint()}</p>
						</div>
						<div class="relative" bind:this={reciterMenu}>
							<button
								type="button"
								class="bg-paper text-body hover:border-faint flex w-full items-center justify-between gap-2 rounded-lg border border-edge px-3 py-2 text-left text-sm transition-colors"
								aria-expanded={reciterOpen}
								onclick={() => (reciterOpen = !reciterOpen)}
							>
								<span class="min-w-0 truncate">
									{currentReciter.name}
									<span class="text-faint">— {currentReciter.style}</span>
								</span>
								<Icon
									name="chevron-down"
									size={14}
									class="text-faint shrink-0 transition-transform {reciterOpen ? 'rotate-180' : ''}"
								/>
							</button>

							{#if reciterOpen}
								<div
									class="bg-surface absolute top-full right-0 left-0 z-30 mt-1.5 overflow-hidden rounded-xl border border-edge p-1 shadow-lg"
									transition:fly={{ y: 4, duration: dur(120) }}
								>
									{#each reciters as reciter (reciter.id)}
										{@const selected = app.prefs.reciter === reciter.id}
										{@const playing = previewId === reciter.id}
										{@const pending = previewPending === reciter.id}
										<!-- Preview and select are sibling buttons (nesting is
										     invalid HTML), sharing one hoverable row. -->
										<div class="flex items-center gap-1">
											<button
												type="button"
												class="text-accent hover:bg-accent-soft flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
												aria-label="{m.reciter_preview()} — {reciter.name}"
												aria-pressed={playing}
												onclick={() => togglePreview(reciter.id)}
											>
												{#if pending}
													<Icon name="spinner" size={12} class="animate-spin" />
												{:else}
													<Icon
														name={playing ? 'pause' : 'play'}
														size={12}
														class={playing ? '' : 'translate-x-px'}
													/>
												{/if}
											</button>
											<button
												type="button"
												class="hover:bg-edge-soft flex min-w-0 grow items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-colors"
												aria-pressed={selected}
												onclick={() => {
													setPref('reciter', reciter.id);
													reciterOpen = false;
												}}
											>
												<span
													class="min-w-0 truncate text-sm {selected
														? 'text-ink font-medium'
														: 'text-body'}"
												>
													{reciter.name}
													<span class="text-faint font-normal">— {reciter.style}</span>
												</span>
												{#if selected}
													<Icon name="check" size={14} class="text-accent shrink-0" />
												{/if}
											</button>
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			</section>

			<!-- Appearance: theme tiles, each a miniature of the reading view. -->
			<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
				<h2
					class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
				>
					{m.settings_appearance()}
				</h2>
				<div class="px-5 py-4">
					<h3 class="text-ink text-sm font-medium">{m.settings_theme()}</h3>
					<p class="text-faint mt-0.5 text-xs leading-relaxed">{m.settings_theme_hint()}</p>
					<div
						class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3"
						role="group"
						aria-label={m.settings_theme()}
					>
						{#each themes as theme (theme)}
							{@const selected = app.prefs.theme === theme}
							<button
								type="button"
								class="group text-left"
								aria-pressed={selected}
								onclick={() => setPref('theme', theme)}
							>
								<!-- data-theme scopes the tokens, so each tile renders a live
								     miniature of the app in its own theme. -->
								<span
									data-theme={theme}
									class="bg-paper block rounded-xl border p-2 transition-all
										{selected
										? 'border-accent shadow-[0_0_0_1px_var(--accent)]'
										: 'border-edge group-hover:border-faint'}"
								>
									<span
										dir="rtl"
										class="bg-surface block rounded-lg border border-edge-soft px-2.5 pt-2 pb-2.5"
									>
										<span class="text-ink font-arabic block truncate text-[13px] leading-relaxed">
											بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
										</span>
										<span class="bg-body/50 mt-1.5 block h-1 w-4/5 rounded-full"></span>
										<span class="bg-muted/40 mt-1 block h-1 w-3/5 rounded-full"></span>
										<span class="bg-accent mt-2 block h-1.5 w-8 rounded-full"></span>
									</span>
								</span>
								<span class="mt-1.5 flex items-center gap-1 px-1">
									<span class="text-body text-xs font-medium {selected ? 'text-ink' : ''}">
										{themeLabels[theme]()}
									</span>
									{#if selected}
										<Icon name="check" size={13} class="text-accent" />
									{/if}
								</span>
							</button>
						{/each}
					</div>
				</div>
			</section>

			<!-- Arabic text: typeface + size live together. -->
			<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
				<h2
					class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
				>
					{m.settings_arabic_text()}
				</h2>
				<div class="divide-y divide-edge-soft">
					<div class="px-5 py-4">
						<h3 class="text-ink text-sm font-medium">{m.settings_arabic_font()}</h3>
						<p class="text-faint mt-0.5 text-xs leading-relaxed">{m.settings_arabic_font_hint()}</p>
						<div class="mt-3 grid gap-2 sm:grid-cols-2">
							{#each fontOptions as font (font.value)}
								{@const selected = app.prefs.arabicFont === font.value}
								<button
									type="button"
									class="relative rounded-xl border px-4 py-3 text-left transition-colors
										{selected ? 'border-accent bg-accent-soft' : 'bg-paper hover:border-faint border-edge'}"
									aria-pressed={selected}
									onclick={() => setPref('arabicFont', font.value)}
								>
									{#if selected}
										<span
											class="bg-accent text-on-accent absolute top-2.5 right-2.5 flex h-4.5 w-4.5 items-center justify-center rounded-full"
										>
											<Icon name="check" size={11} />
										</span>
									{/if}
									<!-- leading-loose + mt-2: Amiri's deep descenders otherwise
									     overlap the label below. -->
									<span
										dir="rtl"
										lang="ar"
										class="text-ink block text-2xl leading-loose"
										style="font-family: {arabicFontStacks[font.value]}"
									>
										بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
									</span>
									<span class="text-faint mt-2 block text-xs font-medium">{font.label}</span>
								</button>
							{/each}
						</div>
					</div>

					<div class="px-5 py-4">
						<h3 class="text-ink text-sm font-medium">{m.settings_arabic_size()}</h3>
						<p class="text-faint mt-0.5 text-xs leading-relaxed">{m.settings_arabic_size_hint()}</p>
						<div class="mt-3 flex items-center gap-3">
							<span class="text-faint font-arabic text-sm leading-none" aria-hidden="true">ب</span>
							<input
								type="range"
								min="1.5"
								max="3"
								step="0.25"
								class="accent-accent w-full max-w-sm"
								bind:value={app.prefs.arabicSize}
								onchange={() => app.persistPrefs()}
							/>
							<span class="text-faint font-arabic text-2xl leading-none" aria-hidden="true">ب</span>
						</div>
						<p
							dir="rtl"
							lang="ar"
							class="font-arabic text-ink bg-paper mt-3 rounded-xl border border-edge-soft px-4 py-5 text-center leading-loose"
							style="font-size: var(--arabic-size)"
						>
							بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ
						</p>
					</div>
				</div>
			</section>

			<!-- Offline storage: install status, re-download, clear. -->
			<OfflineSettings />

			<!-- Keyboard shortcuts. -->
			<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
				<h2
					class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
				>
					{m.settings_shortcuts()}
				</h2>
				<div class="px-5 py-4">
					<p class="text-faint text-xs leading-relaxed">{m.settings_shortcuts_hint()}</p>
					<dl class="mt-3 grid gap-x-10 gap-y-2 sm:grid-cols-2">
						{#each shortcuts as shortcut (shortcut.label)}
							<div class="flex items-center justify-between gap-3">
								<dt class="text-body min-w-0 truncate text-xs">{shortcut.label()}</dt>
								<dd class="flex shrink-0 gap-1">
									{#each shortcut.keys as key (key)}
										<kbd
											class="bg-edge-soft text-muted rounded border border-edge px-1.5 py-0.5 font-sans text-[10px] font-medium"
										>
											{key}
										</kbd>
									{/each}
								</dd>
							</div>
						{/each}
					</dl>
				</div>
			</section>

			<section class="bg-surface overflow-hidden rounded-2xl border border-edge">
				<h2
					class="text-faint border-b border-edge-soft px-5 py-3 text-xs font-semibold tracking-widest uppercase"
				>
					{m.settings_about_section()}
				</h2>
				<div class="divide-y divide-edge-soft">
					<a
						href={resolve('/about')}
						class="text-body hover:bg-edge-soft flex items-center justify-between px-5 py-3.5 text-sm font-medium transition-colors"
					>
						{m.settings_about_page()}
						<Icon name="chevron-right" size={16} class="text-faint" />
					</a>
					<a
						href={resolve('/roadmap')}
						class="text-body hover:bg-edge-soft flex items-center justify-between px-5 py-3.5 text-sm font-medium transition-colors"
					>
						{m.settings_roadmap_page()}
						<Icon name="chevron-right" size={16} class="text-faint" />
					</a>
					<a
						href="https://github.com/fahreziadh/tadabbur"
						target="_blank"
						rel="noopener"
						class="text-body hover:bg-edge-soft flex items-center justify-between px-5 py-3.5 text-sm font-medium transition-colors"
					>
						{m.settings_github()}
						<Icon name="link" size={16} class="text-faint" />
					</a>
				</div>
			</section>
		</div>
	</div>
</main>
