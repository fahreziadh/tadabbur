<script lang="ts">
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import { app } from '$lib/app-state.svelte';
	import { computeStreak, dateKey, lastNDays } from '$lib/progress';
	import { chapterName } from '$lib/quran/locale';
	import { m } from '$lib/paraglide/messages';
	import type { Chapter } from '$lib/quran/types';

	let { chapters }: { chapters: Chapter[] } = $props();

	// Activity lives in localStorage, so show the real numbers only after
	// hydration — the server always renders the empty skeleton.
	let ready = $state(false);
	onMount(() => (ready = true));

	const days = lastNDays(14);
	const todayKey = dateKey(new Date());

	const counts = $derived(days.map((day) => app.activity[day.key]?.length ?? 0));
	const maxCount = $derived(Math.max(1, ...counts));
	const streak = $derived(computeStreak(app.activity));
	const today = $derived(app.activity[todayKey]?.length ?? 0);

	const started = $derived(
		Object.entries(app.surahProgress)
			.map(([surah, maxVerse]) => {
				const chapter = chapters[Number(surah) - 1];
				return {
					chapter,
					maxVerse: Math.min(maxVerse, chapter.versesCount),
					pct: Math.min(100, Math.round((maxVerse / chapter.versesCount) * 100))
				};
			})
			.sort((a, b) => b.pct - a.pct || a.chapter.number - b.chapter.number)
	);
	const completedCount = $derived(started.filter((s) => s.pct >= 100).length);
	const quranPct = $derived(
		((started.reduce((sum, s) => sum + s.maxVerse, 0) / 6236) * 100).toFixed(1)
	);

	const stats = $derived([
		{ label: m.streak_days(), value: String(streak) },
		{ label: m.verses_today(), value: String(today) },
		{ label: m.surahs_completed(), value: String(completedCount) },
		{ label: m.quran_read(), value: `${quranPct}%` }
	]);

	function dayLabel(date: Date): string {
		return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	}
</script>

<div class="grow overflow-y-auto px-3 pb-4">
	<div class="grid grid-cols-2 gap-2">
		{#each stats as stat (stat.label)}
			<div class="bg-surface rounded-xl border border-edge p-3">
				<p class="text-ink text-lg font-semibold tabular-nums">{ready ? stat.value : '–'}</p>
				<p class="text-faint mt-0.5 text-[11px] font-medium">{stat.label}</p>
			</div>
		{/each}
	</div>

	<section class="bg-surface mt-2 rounded-xl border border-edge p-3">
		<h3 class="text-faint text-[11px] font-semibold tracking-widest uppercase">
			{m.last_14_days()}
		</h3>
		<div class="border-edge-soft mt-3 flex h-20 items-end gap-0.5 border-b" aria-hidden="true">
			{#each days as day, i (day.key)}
				<div class="group relative flex h-full flex-1 items-end justify-center">
					{#if ready && counts[i] > 0}
						<div
							class="bg-chart w-full max-w-4 rounded-t-sm"
							style="height: {Math.max(4, (counts[i] / maxCount) * 100)}%"
						></div>
					{:else}
						<div class="bg-edge-soft h-0.5 w-full max-w-4"></div>
					{/if}
					<span
						class="bg-ink text-paper pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 rounded-md px-1.5 py-0.5 text-[11px] whitespace-nowrap group-hover:block"
					>
						{ready ? counts[i] : 0} · {dayLabel(day.date)}
					</span>
				</div>
			{/each}
		</div>
		<div class="text-faint mt-1 flex justify-between text-[10px]">
			<span>{dayLabel(days[0].date)}</span>
			<span>{dayLabel(days[days.length - 1].date)}</span>
		</div>
		<table class="sr-only">
			<caption>{m.verses_read_per_day()}</caption>
			<tbody>
				{#each days as day, i (day.key)}
					<tr><th scope="row">{day.key}</th><td>{ready ? counts[i] : 0}</td></tr>
				{/each}
			</tbody>
		</table>
	</section>

	<section class="mt-5">
		<h3 class="text-faint px-1 text-[11px] font-semibold tracking-widest uppercase">
			{m.in_progress_surahs()}
		</h3>
		{#if ready && started.length > 0}
			<ul class="mt-1">
				{#each started as item (item.chapter.number)}
					<li>
						<a
							href={resolve('/surah/[surah]', { surah: String(item.chapter.number) })}
							class="hover:bg-edge-soft flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors"
						>
							<span
								class="bg-edge-soft text-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold"
							>
								{item.chapter.number}
							</span>
							<span class="min-w-0 grow">
								<span class="flex items-baseline justify-between gap-2">
									<span class="text-ink truncate text-sm font-medium">
										{item.chapter.nameSimple}
										<span class="text-faint font-normal">· {chapterName(item.chapter)}</span>
									</span>
									<span class="text-faint shrink-0 text-xs tabular-nums">
										{item.pct >= 100
											? m.completed()
											: `${item.maxVerse}/${item.chapter.versesCount}`}
									</span>
								</span>
								<span class="bg-edge-soft mt-1.5 block h-1 overflow-hidden rounded-full">
									<span class="bg-chart block h-full rounded-full" style="width: {item.pct}%"
									></span>
								</span>
							</span>
						</a>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-faint mt-2 px-1 text-xs">{m.progress_empty()}</p>
		{/if}
	</section>
</div>
