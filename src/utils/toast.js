/**
 * toast.js — lightweight global toast notification bus.
 * Call showToast() from anywhere; ToastContainer in App.jsx renders them.
 */

export function showToast(message, type = 'success', duration = 8000) {
  window.dispatchEvent(new CustomEvent('mark:toast', {
    detail: { message, type, duration, id: Date.now() + Math.random() }
  }))
}
