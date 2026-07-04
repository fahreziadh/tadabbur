import { browser } from '$app/environment';
import { app } from './app-state.svelte';
import { wordAudioUrl } from './quran/audio';
import { getTimings, type SurahTimings, type VerseTiming } from './quran/timings';

/**
 * One shared gapless-audio player. Playback continues through the surah
 * (follow-along), `currentWord` tracks the word being recited for the
 * karaoke highlight, and a word range can be played on its own.
 */
class Player {
	current: { surah: number; verse: number } | null = $state(null);
	currentWord: number | null = $state(null);
	playing = $state(false);
	/** True from a play request until audio is actually sounding. */
	loading = $state(false);
	/** True while a selected word range (not the whole verse) is playing. */
	rangeActive = $state(false);
	/** True while whole-surah (follow-along) playback is the active intent — not single-ayah, not a word range. */
	continuous = $state(false);

	#audio: HTMLAudioElement | null = null;
	#wordAudio: HTMLAudioElement | null = null;
	#timings: SurahTimings | null = null;
	#loadedKey = '';
	#stopAt: number | null = null;
	#raf = 0;
	#playToken = 0;

	#ensure(): HTMLAudioElement {
		if (!this.#audio) {
			this.#audio = new Audio();
			this.#audio.addEventListener('play', () => {
				this.playing = true;
				this.#raf = requestAnimationFrame(this.#tick);
			});
			this.#audio.addEventListener('pause', () => {
				this.playing = false;
				this.currentWord = null;
				cancelAnimationFrame(this.#raf);
			});
			this.#audio.addEventListener('ended', () => {
				this.playing = false;
				this.#reset();
				cancelAnimationFrame(this.#raf);
			});
			this.#audio.addEventListener('error', () => {
				this.playing = false;
				this.#reset();
			});
		}
		return this.#audio;
	}

	/**
	 * Clears the now-playing identity so every terminal path (ended, error, a
	 * missing timing, a failed load, stop) leaves current/rangeActive/continuous
	 * in sync — otherwise a failed continuous play could strand `continuous` at
	 * true and light the header button with nothing sounding.
	 */
	#reset() {
		this.current = null;
		this.currentWord = null;
		this.rangeActive = false;
		this.continuous = false;
	}

	/**
	 * Prefetches the surah's timings and points the idle audio element at its
	 * MP3, so the first play only needs the seek instead of three round-trips
	 * (timings JSON, then metadata, then the seek itself).
	 */
	warm(surah: number) {
		if (!browser) return;
		// Data Saver users opt out of speculation — first play just pays the fetch.
		if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return;
		const reciter = app.prefs.reciter;
		const key = `${reciter}:${surah}`;
		if (this.#loadedKey === key) return;
		getTimings(reciter, surah)
			.then((timings) => {
				if (this.current || this.#loadedKey === key) return;
				const audio = this.#ensure();
				audio.preload = 'metadata';
				audio.src = timings.audioUrl;
				this.#timings = timings;
				this.#loadedKey = key;
			})
			.catch(() => {});
	}

	/**
	 * Plays a verse from its first word. Default stops at the end of the
	 * ayah; `continuous` keeps reciting through the surah; `words` plays that
	 * range from the stream so the words stay connected as recited.
	 */
	async play(
		surah: number,
		verse: number,
		opts?: { words?: { from: number; to: number }; continuous?: boolean }
	) {
		if (!browser) return;
		const audio = this.#ensure();
		// Stop whatever is sounding right away — otherwise the old position
		// keeps playing audibly until the seek below completes.
		audio.pause();
		this.#wordAudio?.pause();
		const token = ++this.#playToken;
		this.current = { surah, verse };
		this.loading = true;
		this.rangeActive = !!opts?.words;
		// Whole-surah intent — set on every play() so a later single-ayah or
		// word-range play() clears a stale true. A range is never whole-surah.
		this.continuous = opts?.continuous === true && !opts?.words;
		try {
			const key = `${app.prefs.reciter}:${surah}`;
			if (this.#loadedKey !== key) {
				this.#timings = await getTimings(app.prefs.reciter, surah);
				if (token !== this.#playToken) return;
				audio.src = this.#timings.audioUrl;
				this.#loadedKey = key;
			}
			// The src may also have been set by warm() with metadata still in
			// flight — always wait until the element can seek.
			if (audio.readyState < 1) {
				await new Promise<void>((resolve, reject) => {
					audio.addEventListener('loadedmetadata', () => resolve(), { once: true });
					audio.addEventListener('error', () => reject(new Error('audio failed')), { once: true });
				});
				if (token !== this.#playToken) return;
			}
			const timing = this.#timings?.verses[verse - 1];
			if (!timing) {
				this.#reset();
				return;
			}
			// QDC verse windows (timestamp_from/to) bleed into neighboring
			// verses; the word segments are precise, so start at the first
			// word and stop after the last one.
			const firstSeg = timing.segments[0];
			const lastSeg = timing.segments[timing.segments.length - 1];
			let startMs = firstSeg ? firstSeg[1] : timing.from;
			this.#stopAt = opts?.continuous
				? null
				: lastSeg
					? this.#extendPastRelease(lastSeg, verse)
					: timing.to;
			if (opts?.words) {
				const segments = timing.segments.filter(
					(s) => s[0] >= opts.words!.from && s[0] <= opts.words!.to
				);
				if (segments.length) {
					startMs = segments[0][1];
					this.#stopAt = this.#rangeStop(segments[segments.length - 1], verse);
				} else this.rangeActive = false;
			}
			audio.currentTime = startMs / 1000;
			// Only start output once the seek has actually landed.
			if (audio.seeking) {
				await new Promise<void>((resolve) =>
					audio.addEventListener('seeked', () => resolve(), { once: true })
				);
				if (token !== this.#playToken) return;
			}
			await audio.play();
		} catch {
			if (token === this.#playToken) {
				this.#reset();
				this.#loadedKey = '';
			}
		} finally {
			if (token === this.#playToken) this.loading = false;
		}
	}

	/**
	 * A single word plays its QDC per-word recording — sample-accurate where
	 * the stream's word timestamps are not. A range plays from the reciter
	 * stream instead, so the words stay connected as actually recited; its
	 * edges may carry a sliver of the neighboring words.
	 */
	async playWords(surah: number, verse: number, words: { from: number; to: number }) {
		if (!browser) return;
		if (words.from !== words.to) return this.play(surah, verse, { words });
		this.stop();
		const token = ++this.#playToken;
		const audio = (this.#wordAudio ??= new Audio());
		this.current = { surah, verse };
		this.rangeActive = true;
		this.currentWord = words.from;
		this.loading = true;
		try {
			audio.src = wordAudioUrl(surah, verse, words.from);
			await audio.play();
			if (token !== this.#playToken) return;
			this.loading = false;
			this.playing = true;
			// 'pause' also resolves so an external stop()/play() can't strand
			// this await waiting for an 'ended' that never comes.
			await new Promise<void>((resolve, reject) => {
				audio.addEventListener('ended', () => resolve(), { once: true });
				audio.addEventListener('pause', () => resolve(), { once: true });
				audio.addEventListener('error', () => reject(new Error('word audio failed')), {
					once: true
				});
			});
		} catch {
			/* cleanup below */
		} finally {
			if (token === this.#playToken) {
				this.playing = false;
				this.loading = false;
				this.#reset();
			}
		}
	}

	/**
	 * Verse play button: pause if this verse is playing (whole-ayah or
	 * continuous); otherwise ALWAYS restart just this ayah from its beginning
	 * — no mid-verse resume, and a running selection playback is taken over.
	 */
	toggle(surah: number, verse: number) {
		if (!browser) return;
		const isCurrent = this.current?.surah === surah && this.current.verse === verse;
		if (isCurrent && !this.rangeActive && (this.playing || this.loading)) {
			if (this.loading) this.stop();
			else this.#ensure().pause();
			return;
		}
		void this.play(surah, verse);
	}

	/** Mini-player control: pause / resume in place, keeping the position. */
	togglePause() {
		if (!browser || !this.current) return;
		const audio = this.#ensure();
		if (this.playing) audio.pause();
		else void audio.play().catch(() => {});
	}

	/** Stop playback entirely and clear the now-playing state. */
	stop() {
		this.#playToken++;
		this.#audio?.pause();
		this.#wordAudio?.pause();
		this.playing = false;
		this.#reset();
		this.loading = false;
		this.#stopAt = null;
	}

	/**
	 * QDC segment ends land slightly before the recitation actually decays, so
	 * stopping right at one clips a final long harakat. Extend the stop into
	 * the gap that follows — up to the next word's onset (this verse or the
	 * next), never more than a natural release lasts.
	 */
	#extendPastRelease(lastSeg: [number, number, number], verse: number): number {
		const RELEASE_MS = 300;
		const end = lastSeg[2];
		const timing = this.#timings?.verses[verse - 1];
		const nextOnset =
			timing?.segments.find((s) => s[0] > lastSeg[0])?.[1] ??
			this.#timings?.verses[verse]?.segments[0]?.[1] ??
			Infinity;
		return Math.min(end + RELEASE_MS, Math.max(nextOnset, end));
	}

	/**
	 * A range's final boundary is a mid-verse QDC timestamp, which sits
	 * 150-300ms early — bleed a little into the next word rather than clip
	 * this one's final harakat.
	 */
	#rangeStop(lastSeg: [number, number, number], verse: number): number {
		return Math.max(this.#extendPastRelease(lastSeg, verse), lastSeg[2] + 200);
	}

	/** Precise start/end of a verse: its word segments (windows bleed). */
	#spanFrom(timing: VerseTiming): number {
		return timing.segments[0]?.[1] ?? timing.from;
	}

	#spanTo(timing: VerseTiming): number {
		return timing.segments[timing.segments.length - 1]?.[2] ?? timing.to;
	}

	#tick = () => {
		const audio = this.#audio;
		if (!audio || !this.#timings || !this.current) return;
		// While a seek is pending, currentTime still reports the old position —
		// acting on it would flash the previously played verse (and scroll to it).
		if (audio.seeking) {
			if (this.playing) this.#raf = requestAnimationFrame(this.#tick);
			return;
		}
		const t = audio.currentTime * 1000;

		if (this.#stopAt !== null && t >= this.#stopAt) {
			this.#stopAt = null;
			this.rangeActive = false;
			audio.pause();
			return;
		}

		// Track the verse by its precise word-segment span, NOT the QDC verse
		// window — windows overlap neighbors (notably Alafasy), so a window
		// lookup blames the previous verse for the first ~100ms of an ayah.
		// In the silence between spans, stay on the current verse.
		let timing = this.#timings.verses[this.current.verse - 1];
		if (!timing || t < this.#spanFrom(timing) || t >= this.#spanTo(timing)) {
			const found = this.#timings.verses.find((v) => t >= this.#spanFrom(v) && t < this.#spanTo(v));
			if (found) {
				const verse = Number(found.key.split(':')[1]);
				if (verse !== this.current.verse) this.current = { surah: this.current.surah, verse };
				timing = found;
			}
		}
		// Past the last segment but before the scheduled stop is the release
		// tail — keep the final word lit while its harakat decays.
		const segment = timing?.segments.find((s) => t >= s[1] && t < s[2]);
		const word = segment?.[0] ?? (this.#stopAt !== null ? this.currentWord : null);
		if (word !== this.currentWord) this.currentWord = word;

		if (this.playing) this.#raf = requestAnimationFrame(this.#tick);
	};
}

export const player = new Player();
