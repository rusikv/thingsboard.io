/**
 * Product badges for the menu's Products and Docs sections. The two platforms (ThingsBoard and
 * ThingsBoard Cloud) show the ThingsBoard logo on a tile filled with their color; the other products
 * show their glyph (Mobile uses the ThingsBoard logo) on a light tint of their color. A menu link
 * picks its badge by key (`SubMenuItem.badge` in `data/navigation`), so an unknown key fails the type
 * check. A link without a badge (the CLI) shows its nav icon instead.
 *
 * The tile is drawn in CSS (`.sm__badge` in `SiteMenu.astro`) and the glyph comes from the nav sprite
 * (`nav/badge-*.svg`), so each badge is a small `<use>` reference instead of inline artwork. This
 * matters because the menu has 14 badges on every page.
 */
export interface MenuBadge {
	/** `solid`: a tile filled with `hue` and a white glyph. `wash`: a light tint of `hue`. */
	fill: 'solid' | 'wash';
	hue: string;
	/** The glyph's source file, looked up in the nav sprite. */
	glyph: string;
	/**
	 * Glyph size in px inside the 32px tile: 20 for the ThingsBoard logo, 23 for other products, 26 for
	 * TBMQ's wide logo.
	 */
	size: number;
}

const BADGE_FILE_PREFIX = '/src/assets/images/landings/nav/badge-';

export const MENU_BADGES = {
	thingsboard: { fill: 'solid', hue: '#178649', glyph: `${BADGE_FILE_PREFIX}thingsboard.svg`, size: 20 },
	cloud: { fill: 'solid', hue: '#3d50f5', glyph: `${BADGE_FILE_PREFIX}thingsboard.svg`, size: 20 },
	edge: { fill: 'wash', hue: '#2dd4bf', glyph: `${BADGE_FILE_PREFIX}edge.svg`, size: 23 },
	gateway: { fill: 'wash', hue: '#a78bfa', glyph: `${BADGE_FILE_PREFIX}gateway.svg`, size: 23 },
	tbmq: { fill: 'wash', hue: '#4ade80', glyph: `${BADGE_FILE_PREFIX}tbmq.svg`, size: 26 },
	trendz: { fill: 'wash', hue: '#60a5fa', glyph: `${BADGE_FILE_PREFIX}trendz.svg`, size: 23 },
	mobile: { fill: 'wash', hue: '#4ade80', glyph: `${BADGE_FILE_PREFIX}thingsboard.svg`, size: 20 },
} as const satisfies Record<string, MenuBadge>;

export type MenuBadgeKey = keyof typeof MENU_BADGES;
