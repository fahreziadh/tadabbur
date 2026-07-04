import { getLocale } from '$lib/paraglide/runtime';
import type { Chapter, Verse } from './types';

/**
 * The app locale drives which translation is shown everywhere. Locale changes
 * reload the page (cookie strategy), so these don't need to be reactive.
 */

export function chapterName(chapter: Chapter): string {
	const locale = getLocale();
	if (locale === 'ar') return chapter.nameArabic;
	return locale === 'id' ? chapter.nameId : chapter.nameEn;
}

export function verseTranslation(verse: Verse): string {
	return getLocale() === 'id' ? verse.id : verse.en;
}
