import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

const root = ReactDOM.createRoot(document.getElementById('root'))

/**
 * Route the video pop-out BEFORE the app is imported.
 *
 * The pop-out used to load the root URL with ?window=video and rely on a guard
 * inside App(). That guard stopped the app RENDERING, but App.jsx statically
 * imports every page — SessionSetup, Review, Field, Audit, Comparison, Drill —
 * so every one of those modules, and Firebase, and the auth provider, were all
 * evaluated in the pop-out regardless. Routing here means none of them is even
 * fetched: the pop-out loads VideoWindow and nothing else.
 *
 * The marker is a HASH, not a query parameter. A hash is never sent to the
 * asset server and never normalised away, whereas a query string can be — and
 * if it were, the old guard silently failed and the pop-out booted the whole
 * application. A hash also avoids needing a real /video-player file, which
 * would 404 under Tauri's static asset protocol.
 */
if (window.location.hash.startsWith('#video-player')) {
  import('./components/VideoWindow').then(({ default: VideoWindow }) => {
    root.render(<VideoWindow/>)
  }).catch(err => {
    console.error('[MARK] video window failed to load:', err)
    document.getElementById('root').textContent =
      'Video window failed to load: ' + (err?.message || err)
  })
} else {
  import('./App').then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App/>
      </React.StrictMode>
    )
  })
}
