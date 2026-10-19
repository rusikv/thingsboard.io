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
	// Fade out while still open, then close: a close (button, backdrop, Esc) puts this class on the dialog,
	// whose CSS fades it out under the class, and `close()` runs once `fadeMs` has passed. Leaving the modal
	// state restyles the whole page (it stops being inert), and this keeps that work out of the click or key
	// press that asked to close. The dialog then needs no exit transition of its own.
	closingClass?: string;
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
export function bindModalDialog(
	dialog: HTMLDialogElement,
	{ fadeMs = 0, closingClass }: ModalDialogOptions = {}
): ModalDialog {
	const existing = bound.get(dialog);
	if (existing) return existing;
	let unlockTimer = 0;
	let closeTimer = 0;
	// The class a fade-first close puts on, or none when the dialog closes at once.
	const closing = fadeMs > 0 ? closingClass : undefined;

	const stopClosing = () => {
		window.clearTimeout(closeTimer);
		if (closing) dialog.classList.remove(closing);
	};

	// The panel fills the dialog box, so a click on the dialog element itself landed on the backdrop. The press
	// must have too: a text selection dragged out of a field ends with a click on the dialog.
	let pressedBackdrop = false;
	dialog.addEventListener('pointerdown', (e) => {
		pressedBackdrop = e.target === dialog;
	});
	dialog.addEventListener('click', (e) => {
		if (e.target === dialog && pressedBackdrop) modal.close();
	});

	if (closing) {
		// Esc fades out first too. The browser lets a page hold a close request back only after a user
		// activation since the last one, so a repeated Esc may still close at once.
		dialog.addEventListener('cancel', (e) => {
			if (!e.cancelable) return;
			e.preventDefault();
			modal.close();
		});
	}

	dialog.addEventListener('close', () => {
		// `close` is queued: the dialog may have been reopened before it fired.
		if (dialog.open) return;
		stopClosing();
		window.clearTimeout(unlockTimer);
		// A dialog that faded out before closing is already gone.
		if (fadeMs > 0 && !closing) unlockTimer = window.setTimeout(() => release(dialog), fadeMs);
		else release(dialog);
	});

	if (fadeMs > 0 && !closing) {
		dialog.addEventListener('transitionend', (e) => {
			// The dialog's own fade, not a `::backdrop` one, which is dispatched to the dialog too.
			if (e.target === dialog && e.propertyName === 'opacity' && !e.pseudoElement && !dialog.open) {
				window.clearTimeout(unlockTimer);
				release(dialog);
			}
		});
	}

	const modal: ModalDialog = {
		// A reopen during the exit fade keeps the lock instead of releasing it under the open dialog, and a
		// reopen during a fade-first close fades the dialog back in.
		open() {
			window.clearTimeout(unlockTimer);
			stopClosing();
			if (dialog.open) return;
			dialog.showModal();
			holders.add(dialog);
			lockScroll();
		},
		close() {
			if (!dialog.open) return;
			if (!closing) {
				dialog.close();
				return;
			}
			if (dialog.classList.contains(closing)) return;
			dialog.classList.add(closing);
			closeTimer = window.setTimeout(() => {
				dialog.close();
				dialog.classList.remove(closing);
			}, fadeMs);
		},
	};
	bound.set(dialog, modal);
	return modal;
}
