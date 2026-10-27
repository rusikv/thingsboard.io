import { CLOUD_REGIONS, cloudRegionHref } from '@util/cloud-regions';
import { externalLinkAttrs } from '@util/external-links';

/**
 * Where the site's Cloud call-to-action buttons link to, defined in one place so they all go to the
 * same destination.
 *
 * Every "Try for free" and "Start for free" opens the region dialog (`CloudRegionDialog`): the visitor
 * picks North America or Europe, and the sign-up form comes next. The dialog opens from any link with
 * `data-cloud-auth`. The href is only a fallback for when JavaScript is off. It points to the region
 * page rather than the North America sign-up form, which would choose a region for a visitor who
 * never saw the choice.
 */
export const CLOUD_SIGNUP = {
	href: '/installations/choose-region/',
	attrs: { 'data-cloud-auth': 'signup' } as Record<string, string>,
};

/**
 * Every "Sign in" opens the same dialog in sign-in mode. Without JavaScript it falls back to the first
 * region's login page (`CLOUD_REGIONS[0]`) in a new tab, the same way the dialog's region links open.
 */
const signinHref = cloudRegionHref(CLOUD_REGIONS[0], 'signin');
export const CLOUD_SIGNIN = {
	href: signinHref,
	attrs: { ...externalLinkAttrs(signinHref), 'data-cloud-auth': 'signin' } as Record<string, string>,
};
