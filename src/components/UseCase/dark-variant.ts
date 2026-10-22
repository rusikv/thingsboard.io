// Dark twins of the vector art drawn for the use-case pages: application icons, SCADA
// key-function symbols and solution schemes. The twin is the `{base}-dark.svg` sibling of
// the light asset, resolved against a glob: USECASE_DARK_SVGS for the icons and symbols,
// the schemas glob SolutionStructure owns for the schemes.
//
// Contract: every such asset ships a twin, or the data says it reads the same on the dark
// page (`sameInDark: true`). A missing twin fails the build naming the file, so a light
// tile never lands on the dark page silently: a missing file is indistinguishable from a
// forgotten export, which is why the opt-out lives in the data instead. SVG only: a raster
// in one of these slots is a product capture with nothing to recolour, so it can only opt
// out. Outside the contract on purpose: the dashboard captures, the summary illustration
// (hidden in print and below lg), and the docs galleries (ImageGallery, RuleNodeCardGrid),
// which keep their optional fallback.

/** Dark twins of the use-case icons and symbols; only the keys are read, so it stays lazy. */
export const USECASE_DARK_SVGS = import.meta.glob('/src/assets/images/usecases/**/*-dark.svg', {
	query: '?url',
	import: 'default',
});

export interface DarkVariantItem {
	/** Light asset path as written in the data (`/src/assets/...`). */
	src: string;
	/** The art is meant to render as is in both themes; no twin is required. */
	sameInDark?: boolean;
}

/**
 * The twin to render for each item, aligned with `items`: its `-dark.svg` path, or
 * `undefined` for an item that opted out. Throws once for everything that is wrong,
 * naming the files to add, when an item neither opts out nor has its twin among
 * `available` (the keys of the section's glob) or is not an SVG.
 */
export function resolveDarkVariants(
	section: string,
	items: readonly DarkVariantItem[],
	available: Record<string, unknown>
): (string | undefined)[] {
	const twins: (string | undefined)[] = [];
	const missing: string[] = [];
	const rasters: string[] = [];
	for (const { src, sameInDark } of items) {
		if (sameInDark) {
			twins.push(undefined);
			continue;
		}
		if (!src.endsWith('.svg')) {
			rasters.push(src);
			twins.push(undefined);
			continue;
		}
		const twin = `${src.slice(0, -'.svg'.length)}-dark.svg`;
		if (!(twin in available)) missing.push(twin);
		twins.push(twin);
	}
	const errors: string[] = [];
	if (missing.length > 0) {
		errors.push(`no dark variant — add these files, or set \`sameInDark: true\` on the item: ${missing.join(', ')}`);
	}
	if (rasters.length > 0) {
		errors.push(
			`not SVG art, so no dark twin can be resolved — set \`sameInDark: true\` to render as is: ${rasters.join(', ')}`
		);
	}
	if (errors.length > 0) {
		throw new Error(`[use-cases] ${section}: ${errors.join(' | ')}`);
	}
	return twins;
}
