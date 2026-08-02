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
