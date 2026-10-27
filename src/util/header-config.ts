// The site header's appearance, resolved from `BaseLayout`'s props and read by the Starlight Header
// override.
//
// There are two looks:
// - `docs`, on documentation pages: the sidebar's background color with a thin bottom border. It
//   doesn't change on scroll.
// - `marketing`, on every other page: the page background color with a thin bottom border at the top
//   of the page. Once the page scrolls, a shadow replaces the border.
// A marketing page that starts with a hero banner sets `hero`. The header then starts out transparent
// over the banner, with white text over a dark banner and normal text over a light one.
//
// Search is on by default in both looks; its button adapts to the available width (`SearchButton`).
// Pages where visitors come to pick a product rather than look something up (the homepage, the
// product pages) turn it off, which also removes the search dialog and its keyboard shortcuts.
//
// Neither look has a theme toggle in the header: the theme follows the system setting.

export type HeaderLook = 'marketing' | 'docs';

/** The hero banner the page starts with. Sets the header's text color while it is transparent. */
export type HeaderHero = 'dark' | 'light';

export interface HeaderConfig {
	look: HeaderLook;
	hero?: HeaderHero;
	/** Site search in the header: the button, its dialog and its keyboard shortcuts. */
	search: boolean;
	cloudSignupIds: boolean;
	/** Logo only: no menu, search or account buttons (for campaign landing pages). */
	minimal: boolean;
}

export interface HeaderConfigInput {
	look?: HeaderLook;
	hero?: HeaderHero;
	search?: boolean;
	cloudSignupIds?: boolean;
	minimal?: boolean;
}

export function resolveHeaderConfig(input: HeaderConfigInput = {}): HeaderConfig {
	const look = input.look ?? 'docs';
	const minimal = input.minimal ?? false;
	return {
		look,
		// Only marketing pages can start with a hero banner.
		hero: look === 'marketing' ? input.hero : undefined,
		// A minimal header has no search, like it has no other buttons.
		search: !minimal && (input.search ?? true),
		cloudSignupIds: input.cloudSignupIds ?? true,
		minimal,
	};
}
