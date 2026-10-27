/**
 * videoSrc.js — the URL Tag mode gives its <video> element.
 *
 * The local video server (src-tauri, `serve_video`) has two paths:
 *   original  reads the WHOLE requested range into memory before sending a byte. A <video> asks for "from N to the
 *             end of the file", so every seek cost one read of up to the whole file (a real trace: median 309 ms
 *             and 782 MB per request, 99% of it the read).
 *   chunked   (?chunked=1) answers with at most 4 MiB per response, so the first byte arrives in ~2 ms wherever you
 *             seek, answers a request past the end with 416 instead of the whole file, and answers HEAD without
 *             reading anything.
 *
 * Tag mode uses the chunked path. Nothing else does: Scout, Audit, Session History, Insights and Drill build their
 * own URLs and keep the original path exactly as it was.
 *
 * Switches (localStorage, read when a video is opened):
 *   mark_video_legacy = '1'   use the original path (to compare the two in the same build, or to roll back)
 *   mark_perf         = '1'   also ask the server to time each request (Server-Timing + %TEMP%\mark-video-trace.log)
 */
export function videoSrcFor(url, { legacy, trace } = {}) {
  const read = k => { try { return localStorage.getItem(k) === '1' } catch { return false } }
  const useLegacy = legacy ?? read('mark_video_legacy')
  const useTrace = trace ?? read('mark_perf')
  const q = []
  if (!useLegacy) q.push('chunked=1')
  if (useTrace) q.push('trace=1')
  return q.length ? `${url}?${q.join('&')}` : url
}
