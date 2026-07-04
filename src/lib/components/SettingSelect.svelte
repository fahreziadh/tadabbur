<script lang="ts">
	import Icon from './Icon.svelte';

	interface Option {
		value: string;
		label: string;
	}

	let {
		options,
		value,
		onselect
	}: { options: Option[]; value: string; onselect: (value: string) => void } = $props();
</script>

<!-- bg-none drops the forms-plugin chevron; ours matches the reciter menu. -->
<div class="relative">
	<select
		{value}
		class="bg-paper text-body hover:border-faint w-full cursor-pointer appearance-none rounded-lg border border-edge bg-none px-3 py-2 pr-9 text-sm transition-colors"
		onchange={(event) => onselect(event.currentTarget.value)}
	>
		{#each options as option (option.value)}
			<option value={option.value}>{option.label}</option>
		{/each}
	</select>
	<Icon
		name="chevron-down"
		size={14}
		class="text-faint pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
	/>
</div>
