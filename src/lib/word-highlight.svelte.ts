/** Word range marked by the reader — a live drag or an open word popover. */
class WordHighlight {
	range = $state<{ surah: number; verse: number; from: number; to: number } | null>(null);

	covers(surah: number, verse: number, word: number): boolean {
		const r = this.range;
		return !!r && r.surah === surah && r.verse === verse && word >= r.from && word <= r.to;
	}
}

export const wordHighlight = new WordHighlight();
