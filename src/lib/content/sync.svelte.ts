import { dev } from '$app/environment';
import { CONTENT_CACHE } from './manifest';

interface Pack {
	name: string;
	path: string;
	bytes: number;
	files: string[];
}

// Keyed to the cache version so bumping CONTENT_CACHE re-gates everyone.
const INSTALLED_FLAG = `installed:${CONTENT_CACHE}`;

function isInstalled(): boolean {
	try {
		return localStorage.getItem(INSTALLED_FLAG) === '1';
	} catch {
		// Storage blocked — we can't confirm an install, so treat it as absent
		// rather than claiming "Installed" over a cache we can't vouch for.
		return false;
	}
}

export const contentSync = $state({
	// First-run gate ONLY: drives the blocking setup splash. Decided
	// synchronously so the first paint already shows it — waiting for the async
	// cache diff briefly flashed the app underneath. A settings re-download must
	// NOT set this true again (it would re-open the fullscreen splash).
	installing: !dev && typeof caches !== 'undefined' && !isInstalled(),
	// Any sync run is in flight (first-run, load-time gap fill, or a manual
	// re-download). Drives the settings busy state so a background sync started
	// elsewhere can't be clobbered by a concurrent action.
	syncing: false,
	// A clear is in progress. Folded into the settings busy state too, so a
	// re-download can't start mid-clear and race the delete from the other side.
	clearing: false,
	// Packs are actively downloading (vs a quiet verify/gap-fill). Drives the
	// progress readout so a verify-only run reads "Checking…", not a byte count.
	downloading: false,
	receivedBytes: 0,
	totalBytes: 0,
	// Whether the content cache is fully present. Kept in sync by runSync (true
	// only on a complete, error-free run) and clearContent (false).
	installed: !dev && typeof caches !== 'undefined' ? isInstalled() : false
});

/** Shared progress percentage (0–100) for the current download. */
export function syncPct(): number {
	return contentSync.totalBytes
		? Math.min(100, Math.floor((contentSync.receivedBytes / contentSync.totalBytes) * 100))
		: 0;
}

/** Bytes → MB, one decimal, for storage/progress readouts. */
export function formatMb(bytes: number): string {
	return (bytes / 1e6).toFixed(1);
}

export interface StorageUsage {
	/** Bytes this origin uses on the device, or null if the browser won't say. */
	usage: number | null;
	/** Total quota available to the origin, or null if unknown. */
	quota: number | null;
}

/**
 * Whole-origin storage estimate (not content-cache-specific — the browser
 * only reports per-origin). Good enough for a "how much space Tadabbur uses"
 * readout; returns nulls where the API is unavailable or blocked.
 */
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

/**
 * Drops the offline content cache and its install flag, so the next visit (or
 * a manual re-sync) reinstalls from scratch. The app keeps working online —
 * the service worker just falls back to network fetches until refilled.
 */
export async function clearContent(): Promise<void> {
	if (typeof caches === 'undefined') return;
	// `clearing` gates syncContent (and the UI's re-download button) for the
	// whole operation, so a run started *during* the clear can't race the
	// delete from the other side.
	contentSync.clearing = true;
	// Wait out any in-flight sync first — otherwise it holds a pre-delete cache
	// handle and its tail re-sets INSTALLED_FLAG + installed=true, silently
	// undoing the clear and leaving the UI claiming "Installed" over an empty
	// cache. Awaiting guarantees no run is writing when we delete.
	try {
		await syncInFlight;
	} catch {
		// a failed sync is fine — we're about to wipe the cache anyway
	}
	try {
		await caches.delete(CONTENT_CACHE);
	} finally {
		try {
			localStorage.removeItem(INSTALLED_FLAG);
		} catch {
			// storage blocked — flag was best-effort anyway
		}
		contentSync.installed = false;
		contentSync.downloading = false;
		contentSync.receivedBytes = 0;
		contentSync.totalBytes = 0;
		contentSync.clearing = false;
	}
}

/**
 * First visit installs the content packs (4 bundled requests, ~6MB gzipped)
 * behind a blocking setup screen with true byte progress; the pack is split
 * into per-file cache entries so the service worker serves them individually.
 * Later visits fill small gaps (e.g. partial cache eviction) silently, or
 * re-install a pack if most of it is gone.
 */
export function syncContent(): Promise<void> {
	if (dev || typeof caches === 'undefined') return Promise.resolve();
	// A clear is deleting the cache — starting a run now would race the delete
	// and could leave a populated cache flagged uninstalled (or vice versa).
	if (contentSync.clearing) return Promise.resolve();
	// Dedupe concurrent callers onto one run — the first-visit setup screen and
	// a manual re-sync from settings both target the shared contentSync state,
	// and two overlapping runs would double-count bytes and race the flags.
	if (!syncInFlight) {
		contentSync.syncing = true;
		syncInFlight = runSync().finally(() => {
			syncInFlight = null;
			contentSync.syncing = false;
		});
	}
	return syncInFlight;
}

let syncInFlight: Promise<void> | null = null;

async function runSync(): Promise<void> {
	// Fresh counters each run so a verify-only pass reads "Checking…" instead of
	// a stale "Downloading 100%" left over from a previous download.
	contentSync.receivedBytes = 0;
	contentSync.totalBytes = 0;
	try {
		const cache = await caches.open(CONTENT_CACHE);
		const { packs } = (await (await fetch('/pack/manifest.json')).json()) as { packs: Pack[] };
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- cache diff bookkeeping, never rendered
		const cached = new Set((await cache.keys()).map((req) => new URL(req.url).pathname));

		const packsUsable = typeof DecompressionStream !== 'undefined';
		const needed: Pack[] = [];
		const gaps: string[] = [];
		for (const pack of packs) {
			const missing = pack.files.filter((path) => !cached.has(path));
			if (!missing.length) continue;
			if (packsUsable && missing.length > pack.files.length / 4) needed.push(pack);
			else gaps.push(...missing);
		}

		if (needed.length) {
			contentSync.totalBytes = needed.reduce((sum, pack) => sum + pack.bytes, 0);
			contentSync.receivedBytes = 0;
			contentSync.downloading = true;
			for (const pack of needed) await installPack(cache, pack);
		}
		const failures = await fillGaps(cache, gaps);
		// Only claim "installed" when the run actually completed — fillGaps
		// swallows per-file errors, so an offline resync that fetched nothing
		// must not flip the flag and report success over a partial cache.
		if (failures === 0) {
			try {
				localStorage.setItem(INSTALLED_FLAG, '1');
			} catch {
				// storage blocked — the flag is only a fast path, the cache diff still works
			}
			contentSync.installed = true;
		}
	} finally {
		// Close the first-run gate (the splash) once the initial install settles,
		// and clear the active-download flag. `installing` is never set true here
		// — only at module init — so a settings re-download can't reopen the splash.
		contentSync.installing = false;
		contentSync.downloading = false;
	}
}

async function installPack(cache: Cache, pack: Pack): Promise<void> {
	const res = await fetch(pack.path);
	if (!res.ok || !res.body) throw new Error(`Pack ${pack.name} failed: ${res.status}`);

	// Packs are gzipped by the build script (not the CDN), so the stream we
	// count here is real network bytes — the progress bar reflects the wire.
	const counted = res.body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				contentSync.receivedBytes += chunk.length;
				controller.enqueue(chunk);
			}
		})
	);
	// Cast: TS types DecompressionStream's writable as BufferSource, which
	// pipeThrough's Uint8Array generics reject despite being runtime-compatible.
	const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<
		Uint8Array,
		Uint8Array
	>;
	const text = await new Response(counted.pipeThrough(gunzip)).text();

	const { files } = JSON.parse(text) as {
		files: Record<string, unknown>;
	};
	await Promise.all(
		Object.entries(files).map(([path, data]) =>
			cache.put(
				path,
				new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
			)
		)
	);
}

/** Fetches missing files into the cache; returns how many failed. */
async function fillGaps(cache: Cache, gaps: string[]): Promise<number> {
	let next = 0;
	let failures = 0;
	const worker = async () => {
		while (next < gaps.length) {
			const path = gaps[next++];
			try {
				const res = await fetch(path);
				if (res.ok) await cache.put(path, res);
				else failures++;
			} catch {
				// offline or flaky — the next visit retries
				failures++;
			}
		}
	};
	await Promise.all(Array.from({ length: 4 }, worker));
	return failures;
}
