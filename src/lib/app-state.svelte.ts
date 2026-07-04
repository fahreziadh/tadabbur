import { browser } from '$app/environment';
import type { ReciterId } from './quran/audio';
import { dateKey } from './progress';

export type SidebarView = 'surahs' | 'search' | 'notes' | 'progress';
export type Theme = 'light' | 'dark' | 'mushaf' | 'rawdah' | 'sea' | 'night';
export const themes: Theme[] = ['light', 'dark', 'mushaf', 'rawdah', 'sea', 'night'];
/** Themes that also get the `.dark` class (for the `dark:` Tailwind variant). */
// eslint-disable-next-line svelte/prefer-svelte-reactivity -- readonly constant, never mutated
export const darkThemes: ReadonlySet<Theme> = new Set(['dark', 'sea', 'night']);
export type ArabicFont = 'uthmani' | 'amiri' | 'scheherazade' | 'noto';

export const arabicFontStacks: Record<ArabicFont, string> = {
	uthmani: "'KFGQPC Uthmanic Hafs'",
	amiri: "'Amiri Quran'",
	scheherazade: "'Scheherazade New'",
	noto: "'Noto Naskh Arabic'"
};

export interface LastRead {
	surah: number;
	verse: number;
}

const STORAGE_KEY = 'tadabbur:prefs';
const LAST_READ_KEY = 'tadabbur:last-read';
const ACTIVITY_KEY = 'tadabbur:activity';
const SURAH_PROGRESS_KEY = 'tadabbur:surah-progress';
const ACTIVITY_RETENTION_DAYS = 60;

interface Prefs {
	theme: Theme;
	arabicFont: ArabicFont;
	arabicSize: number; // rem
	focusMode: boolean;
	sidebarOpen: boolean;
	infoOpen: boolean;
	reciter: ReciterId;
}

const defaults: Prefs = {
	theme: 'light',
	arabicFont: 'uthmani',
	arabicSize: 2,
	focusMode: false,
	sidebarOpen: true,
	infoOpen: true,
	reciter: 7
};

function loadJson<T>(key: string, fallback: T): T {
	if (!browser) return fallback;
	try {
		const raw = localStorage.getItem(key);
		return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
	} catch {
		return fallback;
	}
}

function loadPrefs(): Prefs {
	const prefs = loadJson(STORAGE_KEY, defaults);
	// Reciter ids moved from everyayah slugs (strings) to QDC ids (numbers).
	if (typeof prefs.reciter !== 'number') prefs.reciter = defaults.reciter;
	// Themes flattened from mode ('system') × palette to a single list.
	const legacy = prefs as Prefs & { palette?: string };
	if (legacy.palette && legacy.palette !== 'default') prefs.theme = legacy.palette as Theme;
	delete legacy.palette;
	if (!themes.includes(prefs.theme)) {
		prefs.theme = browser && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
	}
	return prefs;
}

class AppState {
	view: SidebarView = $state('surahs');
	prefs: Prefs = $state(loadPrefs());
	lastRead: LastRead | null = $state(loadJson<LastRead | null>(LAST_READ_KEY, null));
	/** Verse keys read per local day, e.g. { '2026-07-02': ['1:1', '1:2'] }. */
	activity: Record<string, string[]> = $state(loadJson(ACTIVITY_KEY, {}));
	/** Highest verse reached per surah. */
	surahProgress: Record<number, number> = $state(loadJson(SURAH_PROGRESS_KEY, {}));
	/** Mobile drawer visibility — session-only, never persisted. */
	mobileSidebarOpen = $state(false);

	persistPrefs() {
		if (browser) localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
	}

	constructor() {
		if (browser) window.addEventListener('pagehide', this.#flushProgress);
	}

	setLastRead(surah: number, verse: number) {
		this.lastRead = { surah, verse };
		this.#schedulePersist();
	}

	recordRead(surah: number, verse: number) {
		if (!browser) return;
		const today = dateKey(new Date());
		const verseKey = `${surah}:${verse}`;
		let dirty = false;

		const todays = this.activity[today] ?? [];
		if (!todays.includes(verseKey)) {
			this.activity[today] = [...todays, verseKey];
			dirty = true;
		}
		if ((this.surahProgress[surah] ?? 0) < verse) {
			this.surahProgress[surah] = verse;
			dirty = true;
		}
		if (!dirty) return;

		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- throwaway date math, never rendered
		const cutoff = new Date();
		cutoff.setDate(cutoff.getDate() - ACTIVITY_RETENTION_DAYS);
		const cutoffKey = dateKey(cutoff);
		for (const day of Object.keys(this.activity)) {
			if (day < cutoffKey) delete this.activity[day];
		}
		this.#schedulePersist();
	}

	/**
	 * Reading progress is recorded in memory immediately but persisted on a
	 * debounce — synchronous JSON writes per newly visible verse were heavy
	 * enough to be felt during surah navigation.
	 */
	#persistTimer: ReturnType<typeof setTimeout> | null = null;

	#flushProgress = () => {
		if (this.#persistTimer) clearTimeout(this.#persistTimer);
		this.#persistTimer = null;
		localStorage.setItem(LAST_READ_KEY, JSON.stringify(this.lastRead));
		localStorage.setItem(ACTIVITY_KEY, JSON.stringify(this.activity));
		localStorage.setItem(SURAH_PROGRESS_KEY, JSON.stringify(this.surahProgress));
	};

	#schedulePersist() {
		if (!browser || this.#persistTimer) return;
		this.#persistTimer = setTimeout(this.#flushProgress, 800);
	}

	/**
	 * Activity bar / shortcut behavior: switching views opens the sidebar,
	 * re-activating the current view (or no view) toggles it. Desktop state is
	 * persisted; the mobile drawer is per-session.
	 */
	toggleSidebar(view?: SidebarView) {
		const mobile = browser && window.matchMedia('(max-width: 767px)').matches;
		const isOpen = mobile ? this.mobileSidebarOpen : this.prefs.sidebarOpen;
		const open = view && (view !== this.view || !isOpen) ? true : !isOpen;
		if (view) this.view = view;
		if (mobile) this.mobileSidebarOpen = open;
		else {
			this.prefs.sidebarOpen = open;
			this.persistPrefs();
		}
	}

	closeMobileSidebar() {
		this.mobileSidebarOpen = false;
	}

	/** Bumped to tell the search view to grab focus (Cmd/Ctrl+F). */
	searchFocusTick = $state(0);

	/** Open the search view and focus its input — replaces native find, which
	 * can't see lazily-mounted verses. */
	focusSearch() {
		this.view = 'search';
		if (browser && window.matchMedia('(max-width: 767px)').matches) this.mobileSidebarOpen = true;
		else {
			this.prefs.sidebarOpen = true;
			this.persistPrefs();
		}
		this.searchFocusTick++;
	}
}

export const app = new AppState();
