export interface ThemeContent {
  id: number;
  name: string;
  slug: string;
  coreProblem: string;
  scientificHook: string;
  subjectLines: string[];
  mailerPointers: string[];
  landingPageVariant: string;
  variantLink: string;
  recommendedTemplate: string;
  assets: {
    // Slot names inherited from the repo this compiler was copied from. They
    // describe another company's product line and are rename debt, kept in
    // lock-step with api/_shared/lp-compiler.js and utils/compiler.ts (see the
    // note there). Never rendered to a viewer.
    heroFace?: string;
    ksmRoot?: string;
    periSupport?: string;
    bellyFat?: string;
    tasteAsset?: string;
  };
}

export interface FunnelVariant {
  code: string;
  name: string;
  type: string;
  flowShort: string;
  targetAudience: string;
  why: string;
  description: string;
  deliveryPath: 'checkout' | 'cart';
}

/**
 * Paid-social / paid-search collateral for one theme.
 *
 * This is a derived VIEW over a ThemeContent, never a second store of campaign
 * facts. `adCopyForTheme()` in utils/compiler.ts builds it from the theme's own
 * subject lines, hook and pointers, so there is exactly one place a campaign
 * claim can be written and the ad tab cannot drift from the landing page it
 * points at. Fields with no approved source (audience interest targeting)
 * resolve to a [DATA REQUIRED BEFORE LAUNCH: ...] marker, not a guess.
 */
export interface AdCopyTemplate {
  themeId: number;
  angleName: string;
  targetInterests: string[];
  metaHook: string;
  metaBody: string;
  metaCTA: string;
  googleHeadline1: string;
  googleHeadline2: string;
  googleHeadline3: string;
  googleDescription1: string;
  googleDescription2: string;
  pMaxCallouts: string[];
}
