import { dev } from '$app/environment';
import { CONTENT_CACHE } from './manifest';

interface Pack {
	name: string;
	path: string;
	bytes: number;
	files: string[];
}

const INSTALLED_FLAG = `installed:${CONTENT_CACHE}`;
const ESSENTIAL_FLAG = `essential:${CONTENT_CACHE}`;
const ESSENTIAL_PACK_NAMES = new Set(['quran']);

const offlineSupported = !dev && typeof caches !== 'undefined';

function hasFlag(key: string): boolean {
	try {
		return localStorage.getItem(key) === '1';
	} catch {
		return false;
	}
}

function setFlag(key: string): boolean {
	try {
		localStorage.setItem(key, '1');
		return true;
	} catch {
		return false;
	}
}

function removeFlags(...keys: string[]): boolean {
	try {
		for (const key of keys) localStorage.removeItem(key);
		return true;
	} catch {
		return false;
	}
}

export const contentSync = $state({
	showSetupScreen: offlineSupported && !hasFlag(ESSENTIAL_FLAG) && !hasFlag(INSTALLED_FLAG),
	syncing: false,
	clearing: false,
	downloading: false,
	receivedBytes: 0,
	totalBytes: 0,
	installed: offlineSupported && hasFlag(INSTALLED_FLAG)
});

export function syncPct(): number {
	return contentSync.totalBytes
		? Math.min(100, Math.floor((contentSync.receivedBytes / contentSync.totalBytes) * 100))
		: 0;
}

export function formatMb(bytes: number): string {
	return (bytes / 1e6).toFixed(1);
}

export interface StorageUsage {
	usage: number | null;
	quota: number | null;
}

export async function estimateUsage(): Promise<StorageUsage> {
	if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
		return { usage: null, quota: null };
	}
	try {
		const { usage, quota } = await navigator.storage.estimate();
		return { usage: usage ?? null, quota: quota ?? null };
	} catch {
		return { usage: null, quota: null };
	}
}

export async function clearContent(): Promise<void> {
	if (typeof caches === 'undefined') return;
	contentSync.clearing = true;
	await activeSync?.catch(() => {});
	try {
		await caches.delete(CONTENT_CACHE);
	} finally {
		removeFlags(INSTALLED_FLAG, ESSENTIAL_FLAG);
		contentSync.installed = false;
		contentSync.downloading = false;
		contentSync.receivedBytes = 0;
		contentSync.totalBytes = 0;
		contentSync.clearing = false;
	}
}

export function syncContent(): Promise<void> {
	if (dev || typeof caches === 'undefined') return Promise.resolve();
	if (contentSync.clearing) return Promise.resolve();
	if (!activeSync) {
		contentSync.syncing = true;
		activeSync = runSync().finally(() => {
			activeSync = null;
			contentSync.syncing = false;
		});
	}
	return activeSync;
}

let activeSync: Promise<void> | null = null;

async function runSync(): Promise<void> {
	contentSync.receivedBytes = 0;
	contentSync.totalBytes = 0;
	try {
		const cache = await caches.open(CONTENT_CACHE);
		const { packs } = (await (await fetch('/pack/manifest.json')).json()) as { packs: Pack[] };
		const cachedPaths = new Set((await cache.keys()).map((req) => new URL(req.url).pathname));

		const supportsPacks = typeof DecompressionStream !== 'undefined';
		const packsToInstall: Pack[] = [];
		const missingFiles: string[] = [];
		for (const pack of packs) {
			const missing = pack.files.filter((path) => !cachedPaths.has(path));
			if (!missing.length) continue;
			if (supportsPacks && missing.length > pack.files.length / 4) packsToInstall.push(pack);
			else missingFiles.push(...missing);
		}

		const essentialPacks = packsToInstall.filter((pack) => ESSENTIAL_PACK_NAMES.has(pack.name));
		const deferredPacks = packsToInstall.filter((pack) => !ESSENTIAL_PACK_NAMES.has(pack.name));

		await downloadPacks(cache, essentialPacks);
		setFlag(ESSENTIAL_FLAG);
		contentSync.showSetupScreen = false;

		await downloadPacks(cache, deferredPacks);
		const failures = await downloadMissingFiles(cache, missingFiles);
		if (failures === 0) {
			setFlag(INSTALLED_FLAG);
			contentSync.installed = true;
		}
	} finally {
		contentSync.showSetupScreen = false;
		contentSync.downloading = false;
	}
}

async function downloadPacks(cache: Cache, packs: Pack[]): Promise<void> {
	if (!packs.length) return;
	contentSync.totalBytes += packs.reduce((sum, pack) => sum + pack.bytes, 0);
	contentSync.downloading = true;
	for (const pack of packs) await installPack(cache, pack);
}

async function installPack(cache: Cache, pack: Pack): Promise<void> {
	const res = await fetch(pack.path);
	if (!res.ok || !res.body) throw new Error(`Pack ${pack.name} failed: ${res.status}`);

	const byteCounter = new TransformStream<Uint8Array, Uint8Array>({
		transform(chunk, controller) {
			contentSync.receivedBytes += chunk.length;
			controller.enqueue(chunk);
		}
	});
	const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
		Uint8Array,
		Uint8Array
	>;
	const text = await new Response(res.body.pipeThrough(byteCounter).pipeThrough(gunzip)).text();

	const { files } = JSON.parse(text) as { files: Record<string, unknown> };
	await Promise.all(
		Object.entries(files).map(([path, data]) =>
			cache.put(
				path,
				new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
			)
		)
	);
}

async function downloadMissingFiles(cache: Cache, paths: string[]): Promise<number> {
	let nextIndex = 0;
	let failures = 0;
	const worker = async () => {
		while (nextIndex < paths.length) {
			const path = paths[nextIndex++];
			try {
				const res = await fetch(path);
				if (res.ok) await cache.put(path, res);
				else failures++;
			} catch {
				failures++;
			}
		}
	};
	await Promise.all(Array.from({ length: 4 }, worker));
	return failures;
}
