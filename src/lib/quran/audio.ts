/**
 * Reciters from quran.com's QDC catalog — all verified to ship word-level
 * segment timestamps, which power the karaoke follow-along and playing a
 * selected word range. IDs are QDC reciter ids.
 */

export type ReciterId = number;

/**
 * QDC's per-word recordings (one MP3 per word, teaching voice). Word playback
 * uses these instead of slicing the surah stream: the stream's word
 * timestamps drift ±100–350ms within a verse, which audibly clips harakat.
 */
export function wordAudioUrl(surah: number, verse: number, word: number): string {
	const pad = (n: number) => String(n).padStart(3, '0');
	return `https://audio.qurancdn.com/wbw/${pad(surah)}_${pad(verse)}_${pad(word)}.mp3`;
}

export const reciters: { id: ReciterId; name: string; style: string }[] = [
	{ id: 7, name: 'Mishari Rashid al-`Afasy', style: 'Murattal' },
	{ id: 6, name: 'Mahmoud Khalil Al-Husary', style: 'Murattal' },
	{ id: 12, name: 'Mahmoud Khalil Al-Husary', style: 'Muallim — teaching pace' },
	{ id: 2, name: 'AbdulBaset AbdulSamad', style: 'Murattal' },
	{ id: 9, name: 'Mohamed Siddiq al-Minshawi', style: 'Murattal' },
	{ id: 4, name: 'Abu Bakr al-Shatri', style: 'Murattal' },
	{ id: 3, name: 'Abdur-Rahman as-Sudais', style: 'Murattal' }
];
