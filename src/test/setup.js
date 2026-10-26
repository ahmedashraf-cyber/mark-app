// Vitest setup (jsdom). jsdom has no media playback, no layout and no scrollTo, and the Tag-mode
// page depends on all three, so they are stubbed here — just enough to behave like a <video> that
// can be seeked and played.
//
// React is not driven through act(): the tests wait for real state changes instead, so the
// "not wrapped in act" warning is switched off.
globalThis.IS_REACT_ACT_ENVIRONMENT = false

if (typeof window !== 'undefined') {
  const w = window
  w.Element.prototype.scrollTo = function () {}
  w.Element.prototype.scrollIntoView = function () {}
  const P = w.HTMLMediaElement.prototype
  Object.defineProperty(P, 'currentTime', {
    configurable: true,
    get() { return this._t || 0 },
    set(v) {
      this._t = v; this._seeking = true
      this.dispatchEvent(new w.Event('seeking'))
      setTimeout(() => { this._seeking = false; this.dispatchEvent(new w.Event('seeked')); this.dispatchEvent(new w.Event('timeupdate')) }, 5)
    },
  })
  Object.defineProperty(P, 'seeking', { configurable: true, get() { return !!this._seeking } })
  Object.defineProperty(P, 'duration', { configurable: true, get() { return 2700 } })
  Object.defineProperty(P, 'readyState', { configurable: true, get() { return 4 } })
  Object.defineProperty(P, 'paused', { configurable: true, get() { return this._paused !== false } })
  Object.defineProperty(P, 'muted', { configurable: true, get() { return !!this._muted }, set(v) { this._muted = v } })
  Object.defineProperty(P, 'playbackRate', { configurable: true, get() { return this._rate || 1 }, set(v) { this._rate = v } })
  P.load = function () { setTimeout(() => this.dispatchEvent(new w.Event('loadedmetadata')), 5) }
  P.play = function () {
    if (this._paused === false) return Promise.resolve()
    this._paused = false; this.dispatchEvent(new w.Event('play'))
    this._iv = setInterval(() => { this._t = (this._t || 0) + 0.25; this.dispatchEvent(new w.Event('timeupdate')) }, 250)
    return Promise.resolve()
  }
  P.pause = function () { if (this._paused === false) { this._paused = true; clearInterval(this._iv); this.dispatchEvent(new w.Event('pause')) } }
}
