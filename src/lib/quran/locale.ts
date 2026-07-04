import { getLocale } from '$lib/paraglide/runtime';
import { app } from '$lib/app-state.svelte';
import type { Chapter, Verse } from './types';

/**
 * The app locale drives UI copy and defaults; the translation pref can
 * override which verse translation is shown, or hide it entirely. It reads
 * reactive prefs, so call sites in templates/deriveds update live.
 */

export function chapterName(chapter: Chapter): string {
	const locale = getLocale();
	if (locale === 'ar') return chapter.nameArabic;
	return locale === 'id' ? chapter.nameId : chapter.nameEn;
}

export function translationLang(): 'en' | 'id' | 'off' {
	const pref = app.prefs.translation;
	if (pref !== 'auto') return pref;
	return getLocale() === 'id' ? 'id' : 'en';
}

export function verseTranslation(verse: Verse): string | null {
	const lang = translationLang();
	if (lang === 'off') return null;
	return lang === 'id' ? verse.id : verse.en;
}
