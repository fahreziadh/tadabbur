export const CONTENT_CACHE = 'content-v2';

export function isContentPath(pathname: string): boolean {
	return pathname.startsWith('/quran/') || pathname.startsWith('/tafsir/');
}

export function isPackPath(pathname: string): boolean {
	return pathname.startsWith('/pack/');
}
