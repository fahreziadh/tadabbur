/**
 * Downloads Quran data and builds static per-surah JSON served from /static.
 * Run: bun run scripts/fetch-quran-data.ts
 *
 * Sources:
 * - Arabic (QPC Uthmani Hafs), EN/ID word translations: quran.com QDC API
 * - EN/ID verse translations, chapter metadata, EN tafsir: quran.com API v4
 * - ID tafsir (Tafsir Kemenag): equran.id API v2
 * - ID tafsir (Al-Mukhtasar, Tafsir As-Sa'di): QUL editions via the spa5k/tafsir_api mirror
 *
 * Resources are selected by exact name match against the live resource lists
 * (never hardcoded-by-guess); the chosen IDs are logged and verified.
 *
 * The Arabic text is qpc_uthmani_hafs — the King Fahd Complex's own encoding,
 * which the bundled KFGQPC Hafs font was designed for. quran.com's generic
 * text_uthmani encodes some marks differently (e.g. dagger alif on a tatweel)
 * and the font shapes those wrong. Only the QDC API serves this field.
 */

const QURAN_API = 'https://api.quran.com/api/v4';
const QDC_API = 'https://api.qurancdn.com/api/qdc';
const EQURAN_API = 'https://equran.id/api/v2';
const OUT = new URL('../static', import.meta.url).pathname;

const WANTED = {
	translations: [
		{ language: 'english', name: 'Saheeh International' },
		{ language: 'indonesian', name: 'Indonesian Islamic Affairs Ministry' }
	],
	tafsirEn: { language: 'english', name: 'Ibn Kathir (Abridged)' }
};

const TOTAL_VERSES = 6236;
const SURAH_COUNT = 114;

async function getJson<T>(url: string, attempt = 1): Promise<T> {
	const res = await fetch(url);
	if (!res.ok) {
		if (attempt < 4) {
			await new Promise((r) => setTimeout(r, attempt * 1500));
			return getJson(url, attempt + 1);
		}
		throw new Error(`${res.status} ${res.statusText} for ${url}`);
	}
	return res.json() as Promise<T>;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, async () => {
			while (i < items.length) {
				const idx = i++;
				results[idx] = await fn(items[idx]);
			}
		})
	);
	return results;
}

function write(path: string, data: unknown) {
	return Bun.write(`${OUT}/${path}`, JSON.stringify(data));
}

/** Strip quran.com footnote markers like <sup foot_note=195932>1</sup>. */
function cleanTranslation(text: string): string {
	return text.replace(/<sup[^>]*>.*?<\/sup>/g, '').trim();
}

// --- 1. Resolve resource IDs by exact name ---------------------------------

interface Resource {
	id: number;
	name: string;
	language_name: string;
}

const { translations } = await getJson<{ translations: Resource[] }>(
	`${QURAN_API}/resources/translations`
);
const { tafsirs } = await getJson<{ tafsirs: Resource[] }>(`${QURAN_API}/resources/tafsirs`);

const pick = (list: Resource[], want: { language: string; name: string }) => {
	const found = list.find((r) => r.language_name === want.language && r.name === want.name);
	if (!found) throw new Error(`Resource not found: ${want.name} (${want.language})`);
	console.log(`✓ ${want.language}: "${found.name}" (id ${found.id})`);
	return found;
};

const enTranslation = pick(translations, WANTED.translations[0]);
const idTranslation = pick(translations, WANTED.translations[1]);
const enTafsir = pick(tafsirs, WANTED.tafsirEn);
console.log(`✓ indonesian tafsir: "Tafsir Kemenag" via equran.id`);

// --- 2. Chapters metadata (EN + ID names) -----------------------------------

interface ApiChapter {
	id: number;
	revelation_place: string;
	revelation_order: number;
	bismillah_pre: boolean;
	name_simple: string;
	name_arabic: string;
	verses_count: number;
	pages: [number, number];
	translated_name: { name: string };
}

const [{ chapters: chaptersEn }, { chapters: chaptersId }] = await Promise.all([
	getJson<{ chapters: ApiChapter[] }>(`${QURAN_API}/chapters?language=en`),
	getJson<{ chapters: ApiChapter[] }>(`${QURAN_API}/chapters?language=id`)
]);

const chapters = chaptersEn.map((c, i) => ({
	number: c.id,
	nameArabic: c.name_arabic,
	nameSimple: c.name_simple,
	nameEn: c.translated_name.name,
	nameId: chaptersId[i].translated_name.name,
	revelationPlace: c.revelation_place,
	revelationOrder: c.revelation_order,
	bismillahPre: c.bismillah_pre,
	versesCount: c.verses_count,
	pages: c.pages
}));

if (chapters.length !== SURAH_COUNT)
	throw new Error(`Expected 114 chapters, got ${chapters.length}`);
await write('quran/chapters.json', chapters);
console.log(`✓ chapters.json (${chapters.length} surahs)`);

// --- 3. Verses per surah -----------------------------------------------------

interface ApiWord {
	position: number;
	char_type_name: string;
	qpc_uthmani_hafs: string;
	translation: { text: string };
}

interface ApiVerse {
	verse_number: number;
	verse_key: string;
	qpc_uthmani_hafs: string;
	page_number: number;
	juz_number: number;
	translations: { resource_id: number; text: string }[];
	words: ApiWord[];
}

/** The QDC verse text carries a trailing ayah number — the app draws its own marker. */
function stripVerseNumber(text: string): string {
	return text.replace(/\s*[٠-٩]+\s*$/u, '');
}

/** Ayah-number tokens are usually char_type "end", but 2:181's is mistyped as "word". */
function isVerseWord(w: ApiWord): boolean {
	return w.char_type_name === 'word' && !/^[٠-٩]+$/u.test(w.qpc_uthmani_hafs);
}

async function fetchVerses(surah: number, language: string, withTranslations: boolean) {
	const verses: ApiVerse[] = [];
	const translations = withTranslations
		? `&translations=${enTranslation.id},${idTranslation.id}`
		: '';
	let page = 1;
	while (true) {
		const data = await getJson<{ verses: ApiVerse[]; pagination: { next_page: number | null } }>(
			`${QDC_API}/verses/by_chapter/${surah}?fields=qpc_uthmani_hafs&words=true&word_fields=qpc_uthmani_hafs&language=${language}${translations}&per_page=50&page=${page}`
		);
		verses.push(...data.verses);
		if (!data.pagination.next_page) break;
		page = data.pagination.next_page;
	}
	return verses;
}

let verseTotal = 0;

await pool(chapters, 6, async (chapter) => {
	// Word-by-word translations come one language per request, so fetch twice
	// and merge by word position. Segment timestamps (audio) index the same
	// positions, minus the trailing ayah-number marker (char_type "end").
	const [verses, versesId] = await Promise.all([
		fetchVerses(chapter.number, 'en', true),
		fetchVerses(chapter.number, 'id', false)
	]);
	if (verses.length !== chapter.versesCount) {
		throw new Error(
			`Surah ${chapter.number}: expected ${chapter.versesCount} verses, got ${verses.length}`
		);
	}
	verseTotal += verses.length;
	await write(`quran/${chapter.number}.json`, {
		surah: chapter.number,
		verses: verses.map((v, vi) => {
			const wordsEn = v.words.filter(isVerseWord);
			const wordsId = versesId[vi].words.filter(isVerseWord);
			if (wordsEn.length !== wordsId.length) {
				throw new Error(`Word count mismatch at ${v.verse_key}`);
			}
			return {
				n: v.verse_number,
				key: v.verse_key,
				arabic: stripVerseNumber(v.qpc_uthmani_hafs),
				page: v.page_number,
				juz: v.juz_number,
				en: cleanTranslation(
					v.translations.find((t) => t.resource_id === enTranslation.id)?.text ?? ''
				),
				id: cleanTranslation(
					v.translations.find((t) => t.resource_id === idTranslation.id)?.text ?? ''
				),
				words: wordsEn.map((w, wi) => ({
					a: w.qpc_uthmani_hafs,
					en: w.translation.text ?? '',
					id: wordsId[wi].translation.text ?? ''
				}))
			};
		})
	});
	console.log(`  surah ${chapter.number} (${verses.length} verses)`);
});

if (verseTotal !== TOTAL_VERSES)
	throw new Error(`Expected ${TOTAL_VERSES} verses total, got ${verseTotal}`);
console.log(`✓ all ${verseTotal} verses downloaded`);

// --- 4. Tafsir EN (Ibn Kathir, quran.com) -----------------------------------
// Consecutive verses often share one tafsir passage; group them to save space.

interface ApiTafsir {
	verse_key: string;
	text: string;
}

function groupTafsir(entries: { verseNumber: number; text: string }[]) {
	const groups: { from: number; to: number; text: string }[] = [];
	for (const e of entries) {
		const last = groups[groups.length - 1];
		if (!e.text.trim()) {
			// quran.com puts a passage's text on its first verse only; empty
			// follow-up verses are covered by the preceding passage.
			if (last && e.verseNumber === last.to + 1) last.to = e.verseNumber;
			continue;
		}
		if (last && last.text === e.text && e.verseNumber === last.to + 1) last.to = e.verseNumber;
		else groups.push({ from: e.verseNumber, to: e.verseNumber, text: e.text });
	}
	return groups;
}

await pool(chapters, 6, async (chapter) => {
	const data = await getJson<{ tafsirs: ApiTafsir[] }>(
		`${QURAN_API}/tafsirs/${enTafsir.id}/by_chapter/${chapter.number}?per_page=300`
	);
	if (data.tafsirs.length !== chapter.versesCount)
		throw new Error(
			`Tafsir EN surah ${chapter.number}: expected ${chapter.versesCount}, got ${data.tafsirs.length}`
		);
	const grouped = groupTafsir(
		data.tafsirs.map((t) => ({ verseNumber: Number(t.verse_key.split(':')[1]), text: t.text }))
	);
	await write(`tafsir/ibn-kathir/${chapter.number}.json`, {
		surah: chapter.number,
		source: enTafsir.name,
		entries: grouped
	});
	console.log(`  tafsir en ${chapter.number} (${grouped.length} passages)`);
});
console.log('✓ english tafsir downloaded');

// --- 5. Tafsir ID (Kemenag, equran.id) ---------------------------------------

await pool(chapters, 4, async (chapter) => {
	const data = await getJson<{ code: number; data: { tafsir: { ayat: number; teks: string }[] } }>(
		`${EQURAN_API}/tafsir/${chapter.number}`
	);
	if (data.code !== 200) throw new Error(`equran.id surah ${chapter.number}: code ${data.code}`);
	if (data.data.tafsir.length !== chapter.versesCount) {
		throw new Error(
			`Tafsir ID surah ${chapter.number}: expected ${chapter.versesCount}, got ${data.data.tafsir.length}`
		);
	}
	const grouped = groupTafsir(data.data.tafsir.map((t) => ({ verseNumber: t.ayat, text: t.teks })));
	await write(`tafsir/kemenag/${chapter.number}.json`, {
		surah: chapter.number,
		source: 'Tafsir Kemenag',
		entries: grouped
	});
	console.log(`  tafsir kemenag ${chapter.number} (${grouped.length} passages)`);
});
console.log('✓ tafsir kemenag downloaded');

// --- 6. Tafsir ID (QUL editions via the spa5k/tafsir_api mirror) -------------

const SPA5K_CDN = 'https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir';
const SPA5K_SOURCES = [
	{ slug: 'mukhtasar', edition: 'indonesian-mokhtasar', source: 'Al-Mukhtasar (Tafsir Center)' },
	{ slug: 'as-saadi', edition: 'id-tafsir-as-saadi', source: "Tafsir As-Sa'di" }
];

for (const { slug, edition, source } of SPA5K_SOURCES) {
	await pool(chapters, 6, async (chapter) => {
		const entries = await getJson<{ ayah: number; text: string }[]>(
			`${SPA5K_CDN}/${edition}/${chapter.number}.json`
		);
		// Some QUL editions have isolated editorial gaps (e.g. As-Sa'di 72:11);
		// tolerate those but fail on anything that looks like a truncated file.
		const seen = new Set(entries.map((t) => t.ayah));
		const missing = Array.from({ length: chapter.versesCount }, (_, i) => i + 1).filter(
			(v) => !seen.has(v)
		);
		if (missing.length > 3) {
			throw new Error(
				`${source} surah ${chapter.number}: expected ${chapter.versesCount}, got ${entries.length}`
			);
		}
		if (missing.length) {
			console.warn(`  ⚠ ${source} surah ${chapter.number}: no text for ayah ${missing.join(', ')}`);
		}
		const grouped = groupTafsir(entries.map((t) => ({ verseNumber: t.ayah, text: t.text })));
		await write(`tafsir/${slug}/${chapter.number}.json`, {
			surah: chapter.number,
			source,
			entries: grouped
		});
		console.log(`  tafsir ${slug} ${chapter.number} (${grouped.length} passages)`);
	});
	console.log(`✓ tafsir ${slug} downloaded`);
}
console.log('Done.');
