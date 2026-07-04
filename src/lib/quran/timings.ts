/**
 * Gapless surah audio + word-level timestamps from quran.com's QDC API.
 * Like the MP3s themselves, this is a runtime CDN dependency — timing data
 * belongs to the audio files, so it is not baked into our static data.
 * Segment tuples are [wordPosition (1-based), fromMs, toMs].
 */

const QDC_API = 'https://api.qurancdn.com/api/qdc';

export interface VerseTiming {
	key: string;
	from: number;
	to: number;
	segments: [number, number, number][];
}

export interface SurahTimings {
	audioUrl: string;
	verses: VerseTiming[];
}

interface ApiAudioFile {
	audio_url: string;
	verse_timings: {
		verse_key: string;
		timestamp_from: number;
		timestamp_to: number;
		segments: [number, number, number][];
	}[];
}

const cache = new Map<string, Promise<SurahTimings>>();

export function getTimings(reciter: number, surah: number): Promise<SurahTimings> {
	const key = `${reciter}:${surah}`;
	let hit = cache.get(key);
	if (!hit) {
		hit = fetch(`${QDC_API}/audio/reciters/${reciter}/audio_files?chapter=${surah}&segments=true`)
			.then((res) => {
				if (!res.ok) throw new Error(`Timings failed: ${res.status}`);
				return res.json() as Promise<{ audio_files: ApiAudioFile[] }>;
			})
			.then((data) => {
				const file = data.audio_files[0];
				if (!file) throw new Error('No audio file for reciter');
				return {
					audioUrl: file.audio_url,
					verses: file.verse_timings.map((vt) => ({
						key: vt.verse_key,
						from: vt.timestamp_from,
						to: vt.timestamp_to,
						// QDC data contains stray 1-element tuples (e.g. Alafasy 1:3) —
						// they would poison range ends and the verse span lookups.
						segments: (vt.segments ?? []).filter((s) => s.length === 3)
					}))
				};
			});
		hit.catch(() => cache.delete(key));
		cache.set(key, hit);
	}
	return hit;
}
