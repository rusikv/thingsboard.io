/**
 * Media queries for the widths where the menu changes layout, for use in browser scripts. The values
 * come from CSS custom properties (`--menu-row-from` and the others) that `_theme.scss` sets from
 * `$menu-row-from`, `$menu-split-from` and `$menu-split-min-height` in `styles/_variables.scss`, so
 * each number is defined only once. The queries use `min-width`, the opposite of the stylesheets'
 * `width-below` mixin, so the two ranges meet with no gap.
 *
 * Keep this module free of imports: browser scripts use it (`SiteMenu`, and the header's swipe gesture
 * in `HeaderContent`). Importing from `menu-model` would pull all the navigation data into the page's
 * JavaScript, and the dev server would then keep a stale copy of that data after edits.
 */

const rootCssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Wide screens: the desktop menu row and panel. Below this width: the Menu button and the mobile menu sheet. */
export const menuRowQuery = () => `(min-width: ${rootCssVar('--menu-row-from')})`;

/**
 * Wide and tall enough for the split sheet: the section list as a sidebar beside the open section.
 * Only matters below `menuRowQuery`.
 */
export const menuSplitQuery = () =>
	`(min-width: ${rootCssVar('--menu-split-from')}) and (min-height: ${rootCssVar('--menu-split-min-height')})`;
