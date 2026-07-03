/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

import { build, files, prerendered, version } from '$service-worker';
import { CONTENT_CACHE, isContentPath, isPackPath } from '$lib/content/manifest';

const sw = globalThis.self as unknown as ServiceWorkerGlobalScope;

const APP_CACHE = `app-${version}`;
const appShell = [
	...build,
	...files.filter((path) => !isContentPath(path) && !isPackPath(path)),
	...prerendered
];

const isDevServer = build.length === 0;

sw.addEventListener('install', (event) => {
	if (isDevServer) return void sw.skipWaiting();
	event.waitUntil(
		caches
			.open(APP_CACHE)
			.then((cache) => cache.addAll(appShell))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(Promise.all([sw.clients.claim(), deleteStaleCaches()]));
});

async function deleteStaleCaches(): Promise<void> {
	const keys = await caches.keys();
	const stale = keys.filter((key) => isDevServer || (key !== APP_CACHE && key !== CONTENT_CACHE));
	await Promise.all(stale.map((key) => caches.delete(key)));
}

async function cacheFirst(cacheName: string, request: Request | string): Promise<Response> {
	const cache = await caches.open(cacheName);
	const hit = await cache.match(request);
	if (hit) return hit;
	const response = await fetch(request);
	if (response instanceof Response && response.status === 200) {
		await cache.put(request, response.clone());
	}
	return response;
}

sw.addEventListener('fetch', (event) => {
	if (isDevServer || event.request.method !== 'GET') return;
	const url = new URL(event.request.url);
	const isCrossOrigin = url.origin !== sw.location.origin;
	if (isCrossOrigin || isPackPath(url.pathname)) return;

	if (isContentPath(url.pathname)) {
		event.respondWith(cacheFirst(CONTENT_CACHE, event.request));
	} else if (appShell.includes(url.pathname)) {
		event.respondWith(cacheFirst(APP_CACHE, url.pathname));
	}
});
