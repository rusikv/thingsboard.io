import { lockedByOther } from '@util/scroll-lock';

// Checks for the header's controls that open a layer over the page (the mobile menu sheet, the search
// dialog, the edge swipe that opens the menu). A layer opened under another one can't be reached, and
// a layer opened over another one leaves the first one stuck open underneath.

// Browsers without the Popover API can't parse the `:popover-open` selector.
const supportsPopover = () => typeof HTMLElement.prototype.hidePopover === 'function';

// Scroll-lock owners whose layer opens below the header, so the menu sheet and the search dialog may
// open over it: the IoT Hub filter drawer (`iot-hub-filter-drawer.ts`) hangs from the header's bottom
// edge.
const UNDER_HEADER = ['iot-hub-filter'];

/**
 * Whether another layer already covers the page and the header: an open `<dialog>`, an open popover
 * (such as Starlight's mobile sidebar), or a layer holding the scroll lock (the search dialog, the
 * menu sheet, an image lightbox, the partners filter drawer). `mine` lists the caller's own
 * scroll-lock owners, which don't count.
 */
export function layerOver(...mine: string[]): boolean {
	if (lockedByOther(...mine, ...UNDER_HEADER) || document.querySelector('dialog[open]')) return true;
	return supportsPopover() && document.querySelector(':popover-open') !== null;
}

/**
 * Closes Starlight's sidebar if it is open. On phones the sidebar is a popover in the browser's top
 * layer, so it would be drawn over anything the header opens.
 */
export function dismissSidebar(): void {
	const sidebar = document.getElementById('starlight__sidebar');
	if (sidebar && supportsPopover() && sidebar.matches(':popover-open')) sidebar.hidePopover();
}
