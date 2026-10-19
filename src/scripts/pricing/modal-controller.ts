// Shared open/close controller for the pricing calculator dialogs (CalculatorModal.astro). The native
// <dialog> and `bindModalDialog` give the top layer, inert page, Esc, focus return, backdrop click and the
// scroll lock; this wires the close button and runs the calculator-specific onOpen / onClose hooks.

import { bindModalDialog } from '@util/modal-dialog';

// A close fades the dialog out under this class while it is still open, and closes it afterwards, so the
// whole-page restyle of leaving the modal state lands after the fade, not in the closing click or key press.
// FADE_MS must match the class's fade in CalculatorModal.astro.
const CLOSING_CLASS = 'calc-modal--closing';
const FADE_MS = 300;

interface ModalControllerOptions {
	/** The calculator's `<dialog class="calc-modal-overlay">` (e.g. #tb-pc-calc). */
	modal: HTMLDialogElement;
	/** Per-calculator work after the dialog is shown (e.g. recalc, init sliders). */
	onOpen?: () => void;
	/** Per-calculator work once the dialog has closed (after its fade), by any path: button, Esc or backdrop. */
	onClose?: () => void;
}

export interface ModalController {
	open: () => void;
	close: () => void;
}

export function makeModalController({ modal, onOpen, onClose }: ModalControllerOptions): ModalController {
	const dialog = bindModalDialog(modal, { fadeMs: FADE_MS, closingClass: CLOSING_CLASS });
	modal.querySelector('[data-calc-close]')?.addEventListener('click', () => dialog.close());
	if (onClose) modal.addEventListener('close', onClose);

	return {
		open() {
			// A second click while the calculator chunk loads must not run onOpen (open event, render) twice.
			const wasOpen = modal.open;
			// Also brings the dialog back if it is fading out.
			dialog.open();
			if (!wasOpen) onOpen?.();
		},
		close: () => dialog.close(),
	};
}
