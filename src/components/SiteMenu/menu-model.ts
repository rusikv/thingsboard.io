import { allSubmenus, mainNavItems, type NavItem, type SubMenu } from '@data/navigation';

/**
 * The menu items as `SiteMenu` renders them: the top-level items in order, each with its submenu
 * section if it has one. Built once here so the desktop menu row, the desktop menu panel and the
 * mobile menu sheet all use the same list.
 */
export interface MenuEntry {
	item: NavItem;
	sub?: SubMenu;
}

/** A menu entry that has a section. */
export type MenuSection = Required<MenuEntry>;

export const MENU_ENTRIES: MenuEntry[] = mainNavItems.map((item) => {
	const sub = item.submenuId ? allSubmenus.find((s) => s.id === item.submenuId) : undefined;
	// Each item needs a section or a page; an item with neither would render a link to nowhere.
	if (item.submenuId && !sub)
		throw new Error(`[menu] "${item.label}" names a section "${item.submenuId}" that does not exist`);
	if (!sub && !item.href) throw new Error(`[menu] "${item.label}" has neither a section nor a page`);
	return { item, sub };
});

export const MENU_SECTIONS: MenuSection[] = MENU_ENTRIES.filter(
	(entry): entry is MenuSection => entry.sub !== undefined
);

/**
 * Whether the current page is the given page or below it. Always false for the homepage (`/`),
 * which every path starts with.
 */
export const isHere = (pathname: string, href?: string) => !!href && href !== '/' && pathname.startsWith(href);

const sectionOwnsPage = (pathname: string, sub: SubMenu) => (sub.owns ?? []).some((path) => isHere(pathname, path));

/**
 * Whether the current page belongs to a section. The menu marks that section's item as current, so a
 * visitor on a case study sees Solutions marked.
 *
 * A section that owns the path (`SubMenu.owns`) wins outright, so only one section is ever marked:
 * Products links to the CLI and IoT Gateway docs, but a docs page belongs to Docs. Otherwise the page
 * is in the section when it is the item's own page, or one of the section's internal links, or below
 * one of them.
 */
export const inSection = (pathname: string, { item, sub }: MenuSection) => {
	const owningSection = MENU_SECTIONS.find((section) => sectionOwnsPage(pathname, section.sub));
	if (owningSection) return owningSection.sub.id === sub.id;
	if (isHere(pathname, item.href)) return true;
	return sub.groups.some((group) =>
		group.items.some((link) => link.href.startsWith('/') && isHere(pathname, link.href))
	);
};
