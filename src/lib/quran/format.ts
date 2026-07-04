const arabicIndicDigits = '٠١٢٣٤٥٦٧٨٩';

/** Mushaf verse markers always use Arabic-Indic digits — the Quran fonts don't even carry Latin ones. */
export function arabicVerseNumber(n: number): string {
	return String(n).replace(/\d/g, (digit) => arabicIndicDigits[+digit]);
}
