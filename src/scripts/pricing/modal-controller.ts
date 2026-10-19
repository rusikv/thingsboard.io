// Shared open/close controller for the pricing calculator dialogs (CalculatorModal.astro). The native
// <dialog> and `bindModalDialog` give the top layer, inert page, Esc, focus return, backdrop click and the
// scroll lock; this wires the close button and runs the calculator-specific onOpen / onClose hooks.

import { bindModalDialog } from '@util/modal-dialog';

// The exit fade of `.calc-modal-overlay` in CalculatorModal.astro. Must match. Without `overlay` support the
// dialog closes at once (the fade is gated on it there), so the page unlocks at once too.
const FADE_MS = CSS.supports('overlay', 'auto') ? 300 : 0;

interface ModalControllerOptions {
	/** The calculator's `<dialog class="calc-modal-overlay">` (e.g. #tb-pc-calc). */
	modal: HTMLDialogElement;
	/** Per-calculator work after the dialog is shown (e.g. recalc, init sliders). */
	onOpen?: () => void;
	/** Per-calculator work once the dialog has closed, by any path: button, Esc or backdrop. */
	onClose?: () => void;
}

export interface ModalController {
	open: () => void;
	close: () => void;
}

export function makeModalController({ modal, onOpen, onClose }: ModalControllerOptions): ModalController {
	const dialog = bindModalDialog(modal, { fadeMs: FADE_MS });
	modal.querySelector('[data-calc-close]')?.addEventListener('click', () => dialog.close());
	if (onClose) modal.addEventListener('close', onClose);

	return {
		open() {
			// A second click while the calculator chunk loads must not run onOpen (open event, render) twice.
			if (modal.open) return;
			dialog.open();
			onOpen?.();
		},
		close: () => dialog.close(),
	};
}
