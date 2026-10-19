// Scroll lock and backdrop click for native modal <dialog>s; `showModal()` itself gives the top layer,
// inert page, Esc and focus return. Focus stays in the dialog while the page is inert, but Tab can still
// reach the browser's own UI: it is not a cyclic trap.
//
// Bound dialogs may stack (a second `showModal()` over an open one): the page stays locked until the last
// of them has faded out.

import { lockScroll, unlockScroll } from '@util/scroll-lock';

export interface ModalDialogOptions {
	// Length of the dialog's exit transition: the page scrollbar comes back once it has faded out.
	// An `opacity` transitionend on the dialog releases it sooner.
	fadeMs?: number;
}

export interface ModalDialog {
	open(): void;
	close(): void;
}

const bound = new WeakMap<HTMLDialogElement, ModalDialog>();

// Bound dialogs holding the page scroll lock: each joins on open and leaves once it has faded out, not on
// `close`, so a dialog closed under a still-fading one doesn't cut that fade short.
const holders = new Set<HTMLDialogElement>();

function release(dialog: HTMLDialogElement): void {
	if (holders.delete(dialog) && holders.size === 0) unlockScroll();
}

// Binds once: a later call for the same dialog (e.g. from a component wrapping `Modal.astro`, whose
// script may run first or second) returns the first binding and ignores its options.
export function bindModalDialog(dialog: HTMLDialogElement, { fadeMs = 0 }: ModalDialogOptions = {}): ModalDialog {
	const existing = bound.get(dialog);
	if (existing) return existing;
	let unlockTimer = 0;

	// The panel fills the dialog box, so a click on the dialog element itself landed on the backdrop. The press
	// must have too: a text selection dragged out of a field ends with a click on the dialog.
	let pressedBackdrop = false;
	dialog.addEventListener('pointerdown', (e) => {
		pressedBackdrop = e.target === dialog;
	});
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog && pressedBackdrop) dialog.close();
	});

	dialog.addEventListener('close', () => {
		// `close` is queued: the dialog may have been reopened before it fired.
		if (dialog.open) return;
		window.clearTimeout(unlockTimer);
		if (fadeMs > 0) unlockTimer = window.setTimeout(() => release(dialog), fadeMs);
		else release(dialog);
	});

	if (fadeMs > 0) {
		dialog.addEventListener('transitionend', (e) => {
			// The dialog's own fade, not a `::backdrop` one, which is dispatched to the dialog too.
			if (e.target === dialog && e.propertyName === 'opacity' && !e.pseudoElement && !dialog.open) {
				window.clearTimeout(unlockTimer);
				release(dialog);
			}
		});
	}

	const modal: ModalDialog = {
		// A reopen during the exit fade keeps the lock instead of releasing it under the open dialog.
		open() {
			window.clearTimeout(unlockTimer);
			if (dialog.open) return;
			dialog.showModal();
			holders.add(dialog);
			lockScroll();
		},
		close() {
			if (dialog.open) dialog.close();
		},
	};
	bound.set(dialog, modal);
	return modal;
}
