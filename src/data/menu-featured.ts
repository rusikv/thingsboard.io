import { CLOUD_SIGNUP } from '@data/cta-destinations';

/**
 * Promo links shown at the bottom of a menu section, under its link groups: a row of single-line
 * links, each an icon and a title. One can be `featured`, which shows it in the accent color.
 *
 * Use these only when a section has several extra links that are not part of its lists: Products
 * (pricing, installation options, and the Cloud sign-up, which goes to the same place as every other
 * Cloud sign-up button, see `cta-destinations`) and Docs (the CLI, and getting started). A single
 * extra link, or a list's "see all" link, goes at the end of its group instead (`SubMenuGroup.more`),
 * such as Services' "Talk to an expert" and Solutions' "All use cases" and "All case studies".
 */
export interface MenuPromo {
	icon: string;
	title: string;
	href: string;
	attrs?: Record<string, string>;
	/** Tracking class: the same one the link to this page has in the lists (`cli-lnk`). */
	linkClass?: string;
	featured?: boolean;
}

/** Keyed by section id (`SubMenu.id`). */
export const MENU_SECTION_PROMOS: Record<string, MenuPromo[]> = {
	'nav-products': [
		{ icon: 'tabler:tag', title: 'Pricing', href: '/pricing/' },
		{ icon: 'tabler:download', title: 'Installation options', href: '/installations/' },
		{
			icon: 'tabler:cloud',
			title: 'Start for free on Cloud',
			href: CLOUD_SIGNUP.href,
			attrs: CLOUD_SIGNUP.attrs,
			featured: true,
		},
	],
	'nav-docs': [
		{ icon: 'tabler:terminal-2', title: 'ThingsBoard CLI', href: '/docs/cli/', linkClass: 'cli-lnk' },
		{ icon: 'tabler:rocket', title: 'Getting started', href: '/docs/pe/getting-started/', featured: true },
	],
};
