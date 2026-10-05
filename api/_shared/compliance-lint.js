'use strict';
/**
 * compliance-lint.js — the brand safety and regulatory compliance gate.
 * ---------------------------------------------------------------------------
 * A DETERMINISTIC linter that reads a finished asset (a mailer, an ad, a
 * landing page, or the payload a dispatch job is about to send) and reports
 * every phrase that breaks a rule this brand is bound by, where it is, which
 * rule it breaks, the exact source of that rule, and the fix in a sentence.
 * No model is called. The same input always produces the same findings.
 *
 * ── WHICH RULES APPLY IS READ OFF THE BRAND, NEVER ASSUMED ─────────────────
 * Rule PACKS are keyed by jurisdiction x sector and selected from the ACTIVE
 * brand's own record:
 *
 *   sector        `compliance.sectors` on the record when the operator stated
 *                 it, else the record's own `industry` read against a table
 *                 (a supplement brand, a food brand, a health brand, a beauty
 *                 brand). A sneaker brand matches none and gets no health pack.
 *   jurisdiction  the MARKET the asset is for (US -> the US packs, UK -> the
 *                 UK packs). A send whose market is not one country, or not
 *                 stated, is judged by every jurisdiction shipped here: a gate
 *                 that is lenient because nobody said where the mail goes is a
 *                 hole, not a default.
 *
 * Nothing here names a tenant. The brand's own `voice.banned`, `claims` and
 * `approved_claims` are the only brand facts it reads.
 *
 * ── EVERY RULE CARRIES ITS SOURCE, OR IT IS NOT SHIPPED ────────────────────
 * Each rule cites the regulation or code section it enforces, with a URL, in
 * SOURCES below. A rule nobody could cite is not a rule, it is an opinion with
 * a red badge, and it was left out. The repo's own governing contract
 * (docs/campaign-orchestration-master-spec.md) is cited where the rule is the
 * brand's zero-fabrication rule rather than a regulator's.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 *   - It never rewrites copy. Validation that edits what it validates is how a
 *     sentence becomes a fragment nobody wrote (CLAUDE.md). The exact mandated
 *     disclaimer is OFFERED on the finding for the operator to insert.
 *   - It never invents a citation. A claim with nothing approved behind it is
 *     reported with `[DATA REQUIRED BEFORE LAUNCH: approved claim + citation,
 *     <claim>, <brand>]`.
 *   - A check that could not run is WARN, never pass: an unknown sector, a
 *     market with no shipped pack for a regulated sector, or copy that does not
 *     read as English (the lexicon is English) each say so.
 *
 * ── TEXT, NOT MARKUP ───────────────────────────────────────────────────────
 * HTML is read as a reader sees it: tags stripped, entities decoded, <style>,
 * <script> and <head> skipped, ordinary comments skipped, but Outlook's
 * conditional comments READ (their content is visible to Outlook readers) and
 * image ALT text kept (it is what an images-off reader sees). The hidden
 * preheader is kept too: the inbox shows it. Offsets are reported in the text
 * that was read AND mapped back into the raw field.
 *
 * Word boundaries are Unicode-aware. JavaScript's \b is ASCII-only, so "best"
 * would match inside the German "bestätigt" (the "ä" reads as a boundary).
 *
 * NOT a function file (api/_shared/ -> outside the Hobby 12-function cap).
 * ---------------------------------------------------------------------------
 */

/* ── sources: every rule cites one of these ──────────────────────────────── */

const SOURCES = {
  'cfr21.101.93c': {
    cite: '21 CFR 101.93(c)-(d)',
    title: 'Dietary supplement structure/function statements: the prescribed disclaimer text, placed adjacent to the statement or linked to it by a symbol such as an asterisk',
    url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-F/section-101.93',
  },
  'cfr21.101.93g': {
    cite: '21 CFR 101.93(g)',
    title: 'A statement claims to diagnose, mitigate, treat, cure or prevent disease if it claims, explicitly or implicitly, an effect on a specific disease or its characteristic signs or symptoms',
    url: 'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-101/subpart-F/section-101.93',
  },
  'usc21.343r6': {
    cite: '21 U.S.C. 343(r)(6)',
    title: 'A dietary supplement may describe a structure/function effect only with the disclaimer, and may not claim to diagnose, mitigate, treat, cure or prevent a disease',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section343&num=0&edition=prelim',
  },
  'usc21.321g1': {
    cite: '21 U.S.C. 321(g)(1)(B)',
    title: 'An article intended for use in the diagnosis, cure, mitigation, treatment, or prevention of disease is a drug',
    url: 'https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title21-section321&num=0&edition=prelim',
  },
  'ftc.health': {
    cite: 'FTC Health Products Compliance Guidance (December 2022); FTC Act sections 5 and 12 (15 U.S.C. 45, 52)',
    title: 'Health-related claims must be substantiated by competent and reliable scientific evidence, generally randomised controlled human clinical testing',
    url: 'https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance',
  },
  'ftc.substantiation': {
    cite: 'FTC Policy Statement Regarding Advertising Substantiation',
    title: 'An objective claim needs a reasonable basis before it is disseminated',
    url: 'https://www.ftc.gov/legal-library/browse/ftc-policy-statement-regarding-advertising-substantiation',
  },
  'cfr16.255.5': {
    cite: '16 CFR 255.5',
    title: 'A connection between an endorser and the seller that might materially affect the weight or credibility of the endorsement must be disclosed clearly and conspicuously',
    url: 'https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255/section-255.5',
  },
  'cfr16.255.2b': {
    cite: '16 CFR 255.2(b)',
    title: 'A consumer endorsement on a central attribute is read as representative of what consumers will generally achieve; without substantiation for that, the generally expected performance must be disclosed',
    url: 'https://www.ecfr.gov/current/title-16/chapter-I/subchapter-B/part-255/section-255.2',
  },
  'cap.2': {
    cite: 'CAP Code rules 2.1 and 2.3',
    title: 'Marketing communications must be obviously identifiable as such, and must make clear their commercial intent',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/02.html',
  },
  'cap.3.7': {
    cite: 'CAP Code rule 3.7',
    title: 'Before publication, marketers must hold documentary evidence to prove claims consumers are likely to regard as objective',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/03.html',
  },
  'cap.12.1': {
    cite: 'CAP Code rule 12.1',
    title: 'Objective claims must be backed by evidence, if relevant consisting of trials conducted on people',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/12.html',
  },
  'cap.12.2': {
    cite: 'CAP Code rule 12.2',
    title: 'Marketers must not offer specific advice on, diagnosis of or treatment for conditions for which medical supervision should be sought, unless conducted under a suitably qualified health professional',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/12.html',
  },
  'cap.12.11': {
    cite: 'CAP Code rule 12.11',
    title: 'Medicinal or medical claims may be made only for a licensed medicinal product (MHRA, VMD or EMA) or a marked medical device',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/12.html',
  },
  'cap.15.1.1': {
    cite: 'CAP Code rule 15.1.1',
    title: 'Only health claims listed as authorised on the GB Nutrition and Health Claims Register, or claims with the same meaning to the consumer, may be used',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/15.html',
  },
  'cap.15.6.2': {
    cite: 'CAP Code rule 15.6.2',
    title: 'Claims that state or imply a food prevents, treats or cures human disease are not acceptable',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/15.html',
  },
  'cap.15.6.6': {
    cite: 'CAP Code rule 15.6.6',
    title: 'Health claims that refer to a rate or amount of weight loss are not acceptable',
    url: 'https://www.asa.org.uk/type/non_broadcast/code_section/15.html',
  },
  'gb.nhc': {
    cite: 'Great Britain Nutrition and Health Claims (NHC) Register',
    title: 'The authorised health claims, with their conditions of use',
    url: 'https://www.gov.uk/government/publications/great-britain-nutrition-and-health-claims-nhc-register',
  },
  'reg1924.10.1': {
    cite: 'Regulation (EC) No 1924/2006, Article 10(1) (assimilated law)',
    title: 'Health claims are prohibited unless authorised and included in the lists of authorised claims',
    url: 'https://www.legislation.gov.uk/eur/2006/1924/article/10',
  },
  'reg1924.10.3': {
    cite: 'Regulation (EC) No 1924/2006, Article 10(3) (assimilated law)',
    title: 'A reference to general, non-specific benefits for overall good health may only be made if accompanied by a specific authorised health claim',
    url: 'https://www.legislation.gov.uk/eur/2006/1924/article/10',
  },
  'reg1924.12b': {
    cite: 'Regulation (EC) No 1924/2006, Article 12(b) (assimilated law)',
    title: 'Health claims which make reference to the rate or amount of weight loss shall not be allowed',
    url: 'https://www.legislation.gov.uk/eur/2006/1924/article/12',
  },
  'reg1169.7.3': {
    cite: 'Regulation (EU) No 1169/2011, Article 7(3) (assimilated law)',
    title: 'Food information shall not attribute to any food the property of preventing, treating or curing a human disease',
    url: 'https://www.legislation.gov.uk/eur/2011/1169/article/7',
  },
  'spec.1.1': {
    cite: 'Campaign Orchestration Master Spec §1.1 (zero fabrication)',
    title: 'Never invent claims, certifications, inventory, promo validity dates, customer counts or trust metrics; a missing fact is a DATA REQUIRED marker',
    url: 'docs/campaign-orchestration-master-spec.md',
  },
  'spec.1.9': {
    cite: 'Campaign Orchestration Master Spec §1.9 (compliance-first)',
    title: 'Only claims approved for the exact product, region and channel; never promise guaranteed outcomes or cite a source absent from the approved set',
    url: 'docs/campaign-orchestration-master-spec.md',
  },
  'spec.1.10': {
    cite: 'Campaign Orchestration Master Spec §1.10 (factual review)',
    title: 'Every output is reviewed for unsupported superlatives',
    url: 'docs/campaign-orchestration-master-spec.md',
  },
  'brand.banned': {
    cite: 'Brand record: voice.banned',
    title: 'The phrases this brand has banned from its own copy',
    url: null,
  },
};

/** The two texts 21 CFR 101.93(c) prescribes, word for word. */
const DISCLAIMER_SINGULAR = 'This statement has not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.';
const DISCLAIMER_PLURAL = 'These statements have not been evaluated by the Food and Drug Administration. This product is not intended to diagnose, treat, cure, or prevent any disease.';

/* ── packs ───────────────────────────────────────────────────────────────── */

const SECTORS = ['dietary_supplement', 'food', 'health', 'beauty'];

const PACKS = [
  { id: 'generic', label: 'Brand safety (every brand, every market)', jurisdictions: null, sectors: null },
  { id: 'us.ftc', label: 'US FTC advertising rules (every sector)', jurisdictions: ['US'], sectors: null },
  { id: 'us.fda-ftc.health', label: 'US FDA and FTC rules for foods, dietary supplements and health products', jurisdictions: ['US'], sectors: ['dietary_supplement', 'food', 'health', 'beauty'] },
  { id: 'uk.cap', label: 'UK CAP Code (every sector)', jurisdictions: ['UK'], sectors: null },
  { id: 'uk.cap15', label: 'UK CAP Code section 15: food, food supplements and health claims', jurisdictions: ['UK'], sectors: ['dietary_supplement', 'food'] },
  { id: 'uk.cap12', label: 'UK CAP Code section 12: medicines, health-related and beauty products', jurisdictions: ['UK'], sectors: ['dietary_supplement', 'health', 'beauty'] },
];

/** A sector is read off the record's own words. Explicit `compliance.sectors` wins. */
const SECTOR_TABLE = [
  { id: 'dietary_supplement', rx: /\b(?:dietary\s+)?supplements?\b|\bvitamins?\b|\bnutraceuticals?\b|\bmultivitamins?\b|\bprobiotics?\b|\bprotein\s+powders?\b|\bherbal\s+remed(?:y|ies)\b|\bayurved(?:a|ic)\b/i },
  { id: 'food', rx: /\bfoods?\b|\bbeverages?\b|\bdrinks?\b|\bsnacks?\b|\bgrocer(?:y|ies)\b|\bnutrition\b|\bbakery\b|\bdairy\b|\bconfectioner(?:y|ies)\b|\bchocolates?\b|\bcoffee\b|\btea\b|\bjuices?\b/i },
  { id: 'health', rx: /\bhealth\b|\bwellness\b|\bfitness\b|\bmedical\b|\bpharma(?:ceutical)?s?\b|\bhealthcare\b|\bclinics?\b|\btherap(?:y|ies|eutics?)\b|\bdiagnostics?\b|\btelehealth\b/i },
  { id: 'beauty', rx: /\bbeauty\b|\bcosmetics?\b|\bskin\s*care\b|\bpersonal\s+care\b|\bhair\s*care\b|\bfragrances?\b/i },
];

const JURISDICTIONS = { US: 'US', USA: 'US', UK: 'UK', GB: 'UK', GBR: 'UK' };
const SHIPPED_JURISDICTIONS = ['US', 'UK'];
const NOT_ONE_COUNTRY = new Set(['', 'GLOBAL', 'ALL', 'WW', 'WORLDWIDE', 'ROW', 'INTL', 'INTERNATIONAL']);

/* ── patterns ────────────────────────────────────────────────────────────── */

const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const WORD = "[\\p{L}\\p{N}'’-]+";
// Words inside one block of text: a gap never crosses a line break, which is
// where extraction puts the boundary between two cells or paragraphs.
const SP = '[^\\S\\n]+';
const gap = (max) => `(?:${SP}${WORD}){0,${max}}?${SP}`;
const rx = (src) => new RegExp(src, 'giu');

const DISEASE_TERMS = [
  'anxiety(?:\\s+disorders?)?', 'panic\\s+attacks?', 'depression', 'insomnia', 'sleep\\s+(?:disorders?|apnoea|apnea)',
  'cancers?', 'tumou?rs?', '(?:type\\s+[12]\\s+)?diabetes', 'pre-?diabetes', 'hypertension', 'high\\s+blood\\s+pressure',
  'high\\s+cholesterol', '(?:heart|cardiovascular|coronary|kidney|liver|lung|gum|celiac|coeliac|thyroid|autoimmune)\\s+diseases?',
  'heart\\s+attacks?', 'strokes?', "alzheimer['’]?s(?:\\s+disease)?", 'dementia', "parkinson['’]?s(?:\\s+disease)?",
  '(?:osteo|rheumatoid\\s+)?arthritis', 'osteoporosis', 'asthma', 'eczema', 'psoriasis', 'acne', 'rosacea', 'dermatitis',
  'adhd', 'autism', 'migraines?', 'ibs', 'irritable\\s+bowel\\s+syndrome', "crohn['’]?s(?:\\s+disease)?", 'colitis',
  'ulcers?', '(?:viral\\s+|bacterial\\s+|yeast\\s+|urinary\\s+tract\\s+)?infections?', 'covid(?:-19)?', 'coronavirus',
  'influenza', 'flu', '(?:the\\s+)?common\\s+cold', 'colds', 'cold\\s+sores?', 'hiv', 'hepatitis', 'fatty\\s+liver',
  'obesity', 'erectile\\s+dysfunction', 'impotence', 'infertility', 'pcos', 'endometriosis', 'gout', 'anae?mia',
  'hypothyroidism', 'epilepsy', 'seizures', 'multiple\\s+sclerosis', 'fibromyalgia', 'chronic\\s+fatigue\\s+syndrome',
  'chronic\\s+pain', 'arthritis\\s+pain', 'nerve\\s+pain', 'diseases?', 'disorders?', 'syndromes?',
];
// "Cancer season" is a horoscope, not an oncology claim.
const DISEASE = `(?:${DISEASE_TERMS.map((t) => (t === 'cancers?' ? 'cancers?(?!\\s+(?:season|zodiac|sign))' : t)).join('|')})`;

const DISEASE_VERB = '(?:cur(?:e|es|ed|ing)|treat(?:s|ed|ing)?|prevent(?:s|ed|ing)?|mitigat(?:e|es|ed|ing)|diagnos(?:e|es|ed|ing)'
  + '|heal(?:s|ed|ing)?|revers(?:e|es|ed|ing)|reliev(?:e|es|ed|ing)|fight(?:s|ing)?|combat(?:s|ed|ing|ted|ting)?'
  + '|eliminat(?:e|es|ed|ing)|beat(?:s|ing)?|stop(?:s|ped|ping)?|end(?:s|ed|ing)?|eas(?:e|es|ed|ing)'
  + '|get(?:s|ting)?\\s+rid\\s+of|(?:reduc(?:e|es|ed|ing)|lower(?:s|ed|ing)?|cut(?:s|ting)?)\\s+(?:the\\s+|your\\s+)?risk\\s+of'
  + '|protect(?:s|ed|ing)?\\s+(?:you\\s+|yourself\\s+)?(?:from|against))';
const DISEASE_NOUN = '(?:cures?|treatments?|remed(?:y|ies)|therap(?:y|ies)|relief|prevention|protection|medicine|antidotes?)';

const RX_DISEASE = [
  rx(`${B}${DISEASE_VERB}${gap(3)}${DISEASE}${E}`),
  rx(`${B}${DISEASE_NOUN}\\s+(?:for|from|of|against)${gap(2)}${DISEASE}${E}`),
  rx(`${B}${DISEASE}[\\s-]+(?:cures?|treatments?|remed(?:y|ies)|relief|killers?|fighters?|fighting|busters?|blockers?)${E}`),
  rx(`${B}anti[\\s-]?(?:anxiety|cancer|depressants?|diabetic|viral)${E}`),
];
// "doesn't": the n't is preceded by a letter, so it takes no leading boundary.
const RX_NEGATOR = /(?:(?:^|[^\p{L}\p{N}_])(?:not|no|never|without|cannot|nor)|n['’]t)(?![\p{L}\p{N}_])/iu;

const SF_VERB = '(?:support(?:s|ed|ing)?|promot(?:e|es|ed|ing)|maintain(?:s|ed|ing)?|boost(?:s|ed|ing)?|enhanc(?:e|es|ed|ing)'
  + '|improv(?:e|es|ed|ing)|strengthen(?:s|ed|ing)?|nourish(?:es|ed|ing)?|balanc(?:e|es|ed|ing)|regulat(?:e|es|ed|ing)'
  + '|aid(?:s|ed|ing)?|optimi[sz](?:e|es|ed|ing)|restor(?:e|es|ed|ing)|fuel(?:s|led|ed|ling|ing)?'
  + '|contribut(?:e|es|ed|ing)\\s+to(?:\\s+(?:the|a))?\\s+normal'
  + '|help(?:s|ed|ing)?(?:\\s+(?:to|you|your\\s+body))?\\s+(?:maintain|support|promote|boost|improve|regulate|balance|restore|relax|recover|focus|fall\\s+asleep|sleep)'
  + '|(?:good|great)\\s+for)';
const SF_TARGET = '(?:immune\\s+(?:system|function|health|response|defen[cs]es)|immunity|energy(?:\\s+levels)?|metabolism|metabolic\\s+health'
  + '|digestion|digestive\\s+(?:health|system|comfort)|gut\\s+(?:health|flora|microbiome)|microbiome'
  + '|joint\\s+(?:health|comfort|mobility|function)|joints|cartilage|bone\\s+(?:health|density|strength)|bones'
  + '|heart\\s+health|cardiovascular\\s+(?:health|function|system)|circulation|blood\\s+(?:sugar|glucose)(?:\\s+levels)?'
  + '|cholesterol(?:\\s+levels)?|brain\\s+(?:health|function|power)|cognitive\\s+(?:function|health|performance)|cognition'
  + '|memory|mental\\s+(?:clarity|focus|performance)|focus|concentration|mood|(?:restful\\s+|deep(?:er)?\\s+|better\\s+)?sleep(?:\\s+quality)?'
  + '|relaxation|calm|stress\\s+(?:response|levels|relief)|skin\\s+(?:health|elasticity|hydration|barrier)|collagen(?:\\s+production)?'
  + '|hair\\s+(?:growth|health|strength)|nails|muscle\\s+(?:growth|recovery|function|strength|mass)|recovery'
  + '|liver\\s+(?:health|function)|detox(?:ification)?|hormon(?:e|al)\\s+balance|hormones|eye\\s+health|vision'
  + '|prostate\\s+health|urinary\\s+(?:tract\\s+)?health|libido|stamina|endurance|vitality|well[\\s-]?being|healthy\\s+(?:aging|ageing)'
  + '|psychological\\s+function|nervous\\s+system|(?:the\\s+)?normal\\s+function\\s+of\\s+the\\s+[\\p{L}]+(?:\\s+[\\p{L}]+)?\\s+system'
  + '|healthy\\s+(?:heart|circulation|blood\\s+pressure|cholesterol|blood\\s+sugar|skin|hair|nails|joints|bones|digestion|immune\\s+system|weight|metabolism|sleep|brain))';
const RX_SF = [rx(`${B}${SF_VERB}${gap(3)}${SF_TARGET}${E}`)];

const WL_VERB = '(?:los(?:e|es|ing|t)|drop(?:s|ped|ping)?|shed(?:s|ding)?|burn(?:s|ed|ing|t)?|melt(?:s|ed|ing)?|blast(?:s|ed|ing)?'
  + '|torch(?:es|ed|ing)?|zap(?:s|ped|ping)?|trim(?:s|med|ming)?|slash(?:es|ed|ing)?|flush(?:es|ed|ing)?|block(?:s|ed|ing)?)';
const WL_UNIT = '(?:kgs?|kilos?|kilograms?|lbs?|pounds|stone|st|inches|dress\\s+sizes?|sizes)';
const WL_TARGET = `(?:(?:(?:belly|stomach|body|visceral|stubborn|excess)\\s+)?fat|weight|${WL_UNIT})`;
const RX_WL = [
  rx(`${B}${WL_VERB}${gap(3)}(?:\\d+(?:\\.\\d+)?\\s*)?${WL_TARGET}${E}`),
  rx(`${B}(?:fat[\\s-]?burn(?:er|ers|ing)|weight[\\s-]?loss|slimming|appetite\\s+suppressants?|fat\\s+loss)${E}`),
];
const RX_WL_AMOUNT = new RegExp(`\\d+(?:\\.\\d+)?\\s*${WL_UNIT}(?![\\p{L}\\p{N}_])|${B}in\\s+(?:just\\s+)?\\d+\\s+(?:days?|weeks?|months?)${E}|${B}(?:per|a)\\s+week${E}`, 'iu');

// Claims that need an APPROVED source behind them before they ship.
const RX_CLINICAL = [
  rx(`${B}clinically\\s+(?:proven|tested|shown|studied|validated|backed|effective|demonstrated)${E}`),
  rx(`${B}clinical(?:ly)?\\s+(?:trials?|stud(?:y|ies)|evidence|research|results|data)${E}`),
  rx(`${B}\\d+\\s+(?:clinical\\s+|randomi[sz]ed\\s+|human\\s+)?(?:trials|studies)${E}`),
  rx(`${B}(?:scientifically|medically)\\s+(?:proven|tested|backed|validated)${E}`),
  rx(`${B}(?:science|research|studies|evidence)[\\s-]backed${E}`),
  rx(`${B}proven\\s+to${E}`),
  rx(`${B}(?:dermatologists?|doctors?|physicians?|dentists?|pharmacists?|nutritionists?|dietitians?|paediatricians?|pediatricians?|experts?)[\\s-](?:tested|approved|recommended|formulated|developed|endorsed|trusted)${E}`),
  rx(`${B}dermatologic(?:al)?ly\\s+(?:tested|approved|proven)${E}`),
  rx(`${B}recommended\\s+by\\s+(?:doctors|dermatologists|dentists|physicians|experts|nutritionists|pharmacists)${E}`),
  rx(`${B}(?:\\d+|nine|eight|seven)\\s+out\\s+of\\s+(?:\\d+|ten)\\s+(?:doctors|dentists|dermatologists|users|customers|people|women|men)${E}`),
  rx(`${B}(?:studies|research|science|trials)\\s+(?:shows?|proves?|confirms?|suggests?)${E}`),
  rx(`${B}(?:lab|laboratory)[\\s-]tested${E}`),
  rx(`${B}peer[\\s-]reviewed${E}`),
];
// CLAIM-SHAPED numbers only. A newsletter that reports "the index fell 2%" or
// "1,200 people attended" is reporting, not claiming, and a gate that blocks
// it teaches the operator that overriding is routine. A percentage of
// customers, a count of happy users, a multiplier and a star rating are
// claims about the brand. A discount ("20% off", "save 15%") is an offer, not
// a claim, and is not judged here.
const STAT_NOUNS = '(?:customers|users|members|subscribers|readers|downloads|orders|reviews|ratings|fans|followers|buyers|clients|pairs\\s+sold|units\\s+sold|countries|cities|stores|households|families|patients|athletes|runners|students|parents)';
const STAT_QUAL = '(?:(?:happy|satisfied|verified|loyal|repeat)\\s+)';
const RX_STATISTIC = [
  rx(`${B}\\d+(?:\\.\\d+)?\\s?%\\s+(?:of\\s+(?:${STAT_NOUNS}|people|women|men|participants|respondents|dermatologists|doctors|experts|testers)|more|less|fewer|better|faster|stronger|longer|increase|reduction|improvement|natural|organic|original|pure|recycled|vegan|plant[\\s-]based|satisfaction|satisfied|success|effective|accurate)${E}`),
  rx(`${B}\\d[\\d,.]*\\s?(?:\\+|k\\+?|m\\+?|\\s(?:million|thousand|lakh|crore|billion)\\+?)\\s+${STAT_QUAL}?${STAT_NOUNS}${E}`),
  rx(`${B}\\d[\\d,]*\\s+${STAT_QUAL}${STAT_NOUNS}${E}`),
  rx(`${B}(?:over|more\\s+than|trusted\\s+by|loved\\s+by|joined\\s+by|join)\\s+\\d[\\d,.]*\\s?(?:\\+|k|m|\\s(?:million|thousand|lakh|crore|billion))?\\s+${STAT_QUAL}?(?:${STAT_NOUNS}|people|women|men)${E}`),
  rx(`${B}\\d[\\d,]*\\+?\\s+(?:verified\\s+|(?:5|five)[\\s-]star\\s+)?(?:reviews|ratings)${E}`),
  rx(`${B}\\d+(?:\\.\\d+)?\\s?x\\s+(?:more|faster|better|stronger|longer)${E}`),
  rx(`${B}(?:\\d\\.\\d\\s?/\\s?(?:5|10)|\\d(?:\\.\\d)?\\s+out\\s+of\\s+(?:5|10)|\\d(?:\\.\\d)?\\s?/\\s?(?:5|10)\\s+stars?)${E}`),
  rx('★{3,}'),
];
const OFFER_BEFORE = /(?:save|saving|get|take|extra|flat|up\s+to|upto)\s*$/i;
// A credential is a claim for any brand. A product ATTRIBUTE (organic, vegan,
// cruelty-free ...) is a labelling claim in the sectors that regulate it; in a
// news teaser "organic growth" is reporting, so attributes are read only there.
const RX_CREDENTIAL = [
  rx(`${B}(?:certified|award[\\s-]winning|fda[\\s-](?:approved|registered|cleared)|b\\s+corp(?:oration)?)${E}`),
];
const RX_ATTRIBUTE = [
  rx(`${B}(?:usda\\s+organic|organic|vegan|cruelty[\\s-]free|gluten[\\s-]free|non[\\s-]gmo|hypoallergenic|sugar[\\s-]free|paraben[\\s-]free|non[\\s-]toxic|all[\\s-]natural|100%\\s+natural|eco[\\s-]friendly|carbon[\\s-]neutral|plastic[\\s-]free|sustainabl[ey])${E}`),
];
// BLOCK: shapes that are almost never anything but a claim about the brand.
const RX_SUPERLATIVE = [
  rx(`#\\s?1${E}`),
  rx(`${B}no\\.?\\s?1${E}`),
  rx(`${B}number\\s+one${E}`),
  rx(`${B}best[\\s-]?sell(?:ing|ers?)${E}`),
  rx(`${B}(?:top|highest)[\\s-]rated${E}`),
  rx(`${B}most\\s+(?:trusted|popular|recommended|awarded|effective)${E}`),
];
// WARN: shapes that are a claim when the subject is the brand and reporting
// when it is not ("India's largest bank" in a news teaser). A deterministic
// reader cannot tell which, so it says so instead of blocking.
const RX_SUPERLATIVE_SOFT = [
  rx(`${B}[\\p{L}]+['’]s\\s+(?:largest|biggest|leading|first|favou?rite|best)${E}`),
  rx(`${B}(?:lowest\\s+prices?|cheapest|fastest|strongest|most\\s+(?:loved|advanced))${E}`),
];
const RX_BEST = rx(`${B}best${E}`);
const BEST_IDIOM = /\bbest\s+(?:regards|wishes|friends?|of\s+luck)\b|\ball\s+the\s+best\b|\b(?:do|try)\s+your\s+best\b|\bat\s+(?:its|their|your|our)\s+best\b|\bpersonal\s+best\b|\byour\s+best\s+self\b/i;
const RX_GUARANTEE = rx(`${B}guarantee(?:d|s)?${E}`);
const RX_GUARANTEED_OUTCOME = [
  rx(`${B}guarantee(?:d|s)?${gap(2)}(?:results?|outcomes?|success|weight\\s+loss|to\\s+(?:lose|cure|work|fix|heal|improve|transform|change))${E}`),
  rx(`${B}results?\\s+(?:are\\s+)?guaranteed${E}`),
];

const RX_DEADLINE = [
  rx(`${B}(?:ends?|ending)\\s+(?:tonight|today|tomorrow|soon|at\\s+midnight|this\\s+(?:weekend|week)|in\\s+\\d+\\s+(?:hours?|days?|minutes?))${E}`),
  rx(`${B}today\\s+only${E}`),
  rx(`${B}(?:24|48|72)[\\s-]?hours?\\s+only${E}`),
  rx(`${B}(?:final|last)\\s+(?:hours|day)${E}`),
  rx(`${B}limited[\\s-]time(?:\\s+(?:offer|only))?${E}`),
  rx(`${B}(?:offer\\s+)?expires\\s+(?:tonight|today|soon|in\\s+\\d+)${E}`),
  rx(`${B}last\\s+chance${E}`),
  rx(`${B}(?:the\\s+)?clock\\s+is\\s+ticking${E}`),
];
const RX_SCARCITY = [
  rx(`${B}only\\s+\\d+\\s+(?:left|remaining|available|in\\s+stock)${E}`),
  rx(`${B}\\d+\\s+(?:pairs?|units?|items?|pieces?|spots?|seats?|places?)\\s+left${E}`),
  rx(`${B}selling\\s+(?:out\\s+)?fast${E}`),
  rx(`${B}(?:almost|nearly)\\s+(?:gone|sold\\s+out)${E}`),
  rx(`${B}(?:low|limited)\\s+(?:stock|inventory|quantities|supply)${E}`),
  rx(`${B}while\\s+(?:stocks?|supplies)\\s+last${E}`),
  rx(`${B}going\\s+fast${E}`),
];

// No `i` flag on the two patterns that need a capital: under /iu, \p{Lu}
// matches lower case too, and "loved by many" would read as a named endorser.
const RX_TESTIMONIAL = /[“"]([^”"\n]{12,280})[”"]\s*(?:[-–—]|by\b)\s*([\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){0,3})/gu;
const RX_INFLUENCER = rx(`${B}(?:brand\\s+)?ambassadors?${E}|${B}influencers?${E}|${B}content\\s+creators?${E}|${B}(?:in\\s+)?partner(?:ship|ed)\\s+with${E}|${B}collab(?:oration)?\\s+with${E}|${B}as\\s+(?:worn|used)\\s+by${E}`);
const RX_ENDORSED_BY = new RegExp(`${B}(?:[Ww]orn|[Ll]oved|[Uu]sed|[Ee]ndorsed|[Ss]tyled|[Rr]ecommended)\\s+by\\s+(?:\\p{Lu}[\\p{L}'’-]+|@[A-Za-z0-9_.]{2,30})`, 'gu');
const RX_HANDLE = /(?<![\p{L}\p{N}_.])@([A-Za-z0-9_.]{2,30})(?![\p{L}\p{N}_])/gu;
const RX_DISCLOSURE = rx(`#ad${E}|#advert(?:isement)?${E}|#sponsored${E}|${B}sponsored${E}|${B}paid\\s+(?:partnership|ambassador|partner|promotion)${E}|#gifted${E}|${B}gifted${E}|${B}affiliate${E}|${B}ad\\s*[:|]|${B}advertisement${E}|${B}received\\s+(?:a\\s+)?(?:free|complimentary)${E}|${B}in\\s+exchange\\s+for${E}`);
const RX_RESULT_TESTIMONY = /(?:lost|dropped|shed)\s+\d|\bmy\s+(?:anxiety|sleep|weight|skin|acne|pain|energy|joints|digestion|mood)\b|\bI\s+(?:sleep|slept|feel|felt)\s+(?:better|so\s+much)|\bresults?\b/iu;

const RX_GENERAL_BENEFIT = rx(`${B}(?:good\\s+for\\s+(?:you|your\\s+health|your\\s+body)|promot(?:es|e|ing)\\s+(?:overall\\s+)?(?:good\\s+)?(?:health|well[\\s-]?being)|superfoods?|healthy\\s+choice)${E}`);

const RX_DISCLAIMER_PARAPHRASE = rx(`${B}(?:not\\s+been|hasn['’]t\\s+been|not)\\s+(?:evaluated|approved|reviewed)\\s+by\\s+the\\s+(?:fda|food\\s+and\\s+drug\\s+administration)${E}`);
const RX_MARKER = /\[DATA REQUIRED BEFORE LAUNCH:[^\]]*\]/g;
const LINK_SYMBOLS = '*†‡§';

const ENGLISH_FUNCTION_WORDS = new Set(('the and to of a in for is your you with on it this that our are be at by from or as an we not can will '
  + 'more all now new get just how what when who why its it\'s has have was were one each here there into out up about '
  + 'than then them they their my me i us so if no do does every any these those which while after before over').split(' '));

/* ── text extraction ─────────────────────────────────────────────────────── */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“',
  mdash: '—', ndash: '–', hellip: '…', trade: '™', reg: '®', copy: '©', middot: '·', bull: '•', pound: '£',
  euro: '€', dagger: '†', Dagger: '‡', sect: '§', star: '☆', deg: '°', times: '×', zwnj: '', zwj: '', shy: '',
};
const SKIP_CONTENT = new Set(['style', 'script', 'head', 'title', 'noscript', 'template']);
const BLOCK_TAGS = new Set(['p', 'div', 'td', 'th', 'tr', 'table', 'tbody', 'thead', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'blockquote', 'center', 'hr', 'br', 'figure', 'figcaption', 'button', 'form', 'label', 'option']);

/**
 * HTML to the text a reader sees, with a map from every text character back to
 * its index in the raw HTML, so a finding can point into either.
 */
function extractText(html) {
  const src = String(html || '');
  const out = [];
  const map = [];
  const n = src.length;
  const pushChar = (ch, at) => {
    if (/\s/.test(ch)) {
      if (!out.length) return;
      const last = out[out.length - 1];
      if (last === ' ' || last === '\n') return;
      out.push(' '); map.push(at); return;
    }
    out.push(ch); map.push(at);
  };
  const boundary = (at) => {
    if (!out.length) return;
    const last = out[out.length - 1];
    if (last === '\n') return;
    if (last === ' ') { out[out.length - 1] = '\n'; return; }
    out.push('\n'); map.push(at);
  };
  const decodeAt = (i) => {
    const m = /^&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/i.exec(src.slice(i, i + 12));
    if (!m) return null;
    const k = m[1];
    let ch = null;
    if (k[0] === '#') {
      const code = k[1] === 'x' || k[1] === 'X' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) ch = String.fromCodePoint(code);
    } else if (Object.prototype.hasOwnProperty.call(ENTITIES, k)) ch = ENTITIES[k];
    return ch == null ? null : { ch, len: m[0].length };
  };
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '<') {
      if (src.startsWith('<!--', i)) {
        // Outlook's conditional comments carry markup Outlook DISPLAYS, so
        // their content is read; only the opener is skipped.
        const cond = /^<!--\[if[^\]]*\]>(?:<!-->)?/i.exec(src.slice(i, i + 120));
        if (cond) { i += cond[0].length; continue; }
        if (src.startsWith('<!-->', i)) { i += 5; continue; }
        const end = src.indexOf('-->', i + 4);
        i = end < 0 ? n : end + 3;
        continue;
      }
      if (src.startsWith('<![endif]', i)) {
        const end = src.indexOf('>', i);
        i = end < 0 ? n : end + 1;
        if (src.startsWith('-->', i)) i += 3;
        continue;
      }
      if (src.startsWith('<!', i) || src.startsWith('<?', i)) {
        const end = src.indexOf('>', i);
        i = end < 0 ? n : end + 1;
        continue;
      }
      const nameM = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(src.slice(i, i + 64));
      if (!nameM) { pushChar(c, i); i += 1; continue; }
      // Find the end of the tag, honouring quoted attribute values.
      let j = i + nameM[0].length;
      let q = null;
      while (j < n) {
        const d = src[j];
        if (q) { if (d === q) q = null; } else if (d === '"' || d === "'") q = d; else if (d === '>') break;
        j += 1;
      }
      const tagEnd = j < n ? j + 1 : n;
      const closing = nameM[1] === '/';
      const name = nameM[2].toLowerCase();
      if (!closing && SKIP_CONTENT.has(name)) {
        const close = src.toLowerCase().indexOf(`</${name}`, tagEnd);
        const after = close < 0 ? n : src.indexOf('>', close);
        i = after < 0 ? n : after + 1;
        continue;
      }
      if (BLOCK_TAGS.has(name)) boundary(i);
      if (!closing && name === 'img') {
        const tag = src.slice(i, tagEnd);
        const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
        if (alt) {
          const val = alt[1] != null ? alt[1] : (alt[2] != null ? alt[2] : alt[3]);
          const valStart = i + alt.index + alt[0].length - val.length - (alt[3] != null ? 0 : 1);
          boundary(i);
          let k = 0;
          while (k < val.length) {
            if (val[k] === '&') { const dec = decodeAt(valStart + k); if (dec) { for (const ch of dec.ch) pushChar(ch, valStart + k); k += dec.len; continue; } }
            pushChar(val[k], valStart + k); k += 1;
          }
          boundary(tagEnd - 1);
        }
      }
      i = tagEnd;
      continue;
    }
    if (c === '&') {
      const dec = decodeAt(i);
      if (dec) { for (const ch of dec.ch) pushChar(ch, i); i += dec.len; continue; }
    }
    pushChar(c, i);
    i += 1;
  }
  while (out.length && /\s/.test(out[out.length - 1])) { out.pop(); map.pop(); }
  return { text: out.join(''), map };
}

/** A plain string, whitespace collapsed, with its own index map. */
function plainText(s) {
  const src = String(s == null ? '' : s);
  const out = [];
  const map = [];
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      if (!out.length) continue;
      const last = out[out.length - 1];
      if (ch === '\n') { if (last === ' ') { out[out.length - 1] = '\n'; } else if (last !== '\n') { out.push('\n'); map.push(i); } continue; }
      if (last === ' ' || last === '\n') continue;
      out.push(' '); map.push(i); continue;
    }
    out.push(ch); map.push(i);
  }
  while (out.length && /\s/.test(out[out.length - 1])) { out.pop(); map.pop(); }
  return { text: out.join(''), map };
}

/* ── which fields of an asset are copy ───────────────────────────────────── */

const TEXT_KEYS = ['subject', 'subject_alt1', 'subject_alt2', 'preheader', 'preview_text', 'hook', 'hero_headline', 'hero_sub',
  'headline', 'title', 'intro_paragraph', 'body_paragraph', 'why_title', 'primary_text', 'description', 'caption', 'script',
  'cta', 'proof_quote', 'proof_author', 'guarantee', 'sms_body', 'body', 'message', 'link_description', 'text', 'overlay_text',
  'path1', 'path2',
  // Every copy field asset-specs.js FIELDS defines (email, landing, ad,
  // social), and the accessibility text a platform publishes: a Pin's
  // alt_text is public, and alt text is what a screen reader speaks.
  'alt_text', 'alt', 'image_alt', 'subject_line', 'from_name', 'cta_text', 'cta_label', 'seo_title', 'meta_description',
  'og_title', 'og_description', 'h1', 'first_comment', 'cover_text', 'headings', 'hashtags'];
const LIST_KEYS = ['headlines', 'descriptions', 'why_bullets', 'benefits', 'badges', 'headings', 'hashtags', 'alt_texts'];
const HTML_KEYS = ['html', 'motion_html', 'body_html'];

function looksLikeHtml(s) { return /<\/?[a-z][\s\S]*?>/i.test(String(s || '')); }

/**
 * The copy fields of an asset, in reading order. A raw string is one field. An
 * email's variants and a video ad's motion artefact are read too: they are what
 * the reviewer previews and what ships.
 */
function fieldsOf(asset) {
  const fields = [];
  const add = (name, raw, html) => {
    if (raw == null) return;
    const s = typeof raw === 'string' ? raw : (typeof raw === 'number' ? String(raw) : null);
    if (s == null || !s.trim()) return;
    const ex = html || looksLikeHtml(s) ? extractText(s) : plainText(s);
    if (!ex.text.trim()) return;
    fields.push({ field: name, raw: s, text: ex.text, map: ex.map, html: !!(html || looksLikeHtml(s)) });
  };
  if (typeof asset === 'string') { add('text', asset, false); return fields; }
  const a = asset && typeof asset === 'object' ? asset : {};
  for (const k of TEXT_KEYS) if (typeof a[k] === 'string') add(k, a[k], false);
  for (const k of LIST_KEYS) {
    if (Array.isArray(a[k])) a[k].forEach((v, i) => { if (typeof v === 'string') add(`${k}[${i}]`, v, false); else if (v && typeof v === 'object' && typeof v.text === 'string') add(`${k}[${i}]`, v.text, false); });
  }
  if (Array.isArray(a.faq)) a.faq.forEach((f, i) => { if (f && typeof f === 'object') { add(`faq[${i}].q`, f.q, false); add(`faq[${i}].a`, f.a, false); } });
  for (const k of HTML_KEYS) if (typeof a[k] === 'string') add(k, a[k], true);
  if (a.creative && typeof a.creative === 'object' && typeof a.creative.motion_html === 'string') add('creative.motion_html', a.creative.motion_html, true);
  if (Array.isArray(a.variants)) {
    a.variants.forEach((v, i) => {
      if (!v || typeof v !== 'object') return;
      if (typeof v.subject === 'string') add(`variants[${i}].subject`, v.subject, false);
      if (typeof v.html === 'string') add(`variants[${i}].html`, v.html, true);
    });
  }
  return fields;
}

/**
 * Which surface a field ships on, for disclosures. A disclosure has to be
 * seen WITH the endorsement it discloses, so:
 *  - each email variant is its own surface (only one of them is sent to a
 *    person), and so is each RSA headline or description when there are
 *    several (Google assembles them, so no other one is guaranteed beside it)
 *    and each subject line when there are alternatives;
 *  - METADATA never discloses for anything else: a search snippet, a link
 *    preview card, alt text a screen reader speaks, a comment under the post
 *    (and a snippet or card, seen on its own, is disclosed only by itself);
 *  - every other field ships together (a caption and its hashtags, a subject
 *    and its preheader and body), and an alternative ships with those too.
 */
const DETACHED_METADATA = new Set(['meta_description', 'seo_title', 'og_title', 'og_description']);
const ATTACHED_METADATA = new Set(['alt_text', 'alt', 'image_alt', 'alt_texts', 'first_comment']);
const ALTERNATIVE_LISTS = new Set(['headlines', 'descriptions']);
const SUBJECT_ALTERNATIVES = new Set(['subject', 'subject_alt1', 'subject_alt2']);

function surfaceOf(name, fields) {
  const v = /^variants\[(\d+)\]/.exec(name);
  if (v) return { group: `variants[${v[1]}]`, alone: false, metadata: false };
  const base = name.replace(/[[.].*$/, '');
  // A search snippet or a link card is seen on its own; alt text and a first
  // comment are seen with the post, so the post's disclosure covers them.
  if (DETACHED_METADATA.has(base)) return { group: name, alone: true, metadata: true };
  if (ATTACHED_METADATA.has(base)) return { group: 'main', alone: false, metadata: true };
  if (ALTERNATIVE_LISTS.has(base) && fields.filter((f) => f.field.startsWith(`${base}[`)).length > 1) return { group: 'main', alone: true, metadata: false };
  if (SUBJECT_ALTERNATIVES.has(name) && fields.some((f) => f.field === 'subject_alt1' || f.field === 'subject_alt2')) return { group: 'main', alone: true, metadata: false };
  return { group: 'main', alone: false, metadata: false };
}

function disclosureBySurface(fields) {
  const at = fields.map((f) => {
    RX_DISCLOSURE.lastIndex = 0;
    return { f, s: surfaceOf(f.field, fields), disclosed: RX_DISCLOSURE.test(f.text) };
  });
  return (field) => {
    const me = at.find((x) => x.f === field);
    if (!me) return false;
    if (me.disclosed) return true;
    // Another field discloses for this one only when it is not metadata, is
    // on the same surface, and always ships (an alternative does not).
    return at.some((x) => x !== me && x.disclosed && !x.s.metadata && !x.s.alone && x.s.group === me.s.group);
  };
}

/* ── brand reading ───────────────────────────────────────────────────────── */

function fieldOf(brand, key) {
  if (!brand || typeof brand !== 'object') return undefined;
  if (brand[key] !== undefined && brand[key] !== null) return brand[key];
  const data = brand.brand_data;
  return data && typeof data === 'object' ? data[key] : undefined;
}
function brandNameOf(brand) {
  const n = brand && typeof brand.name === 'string' ? brand.name.trim() : '';
  return n && !/^\[DATA REQUIRED/.test(n) ? n : 'this brand';
}

/**
 * Regulated sectors this gate ships NO rule pack for. Read FIRST, and a hit
 * anywhere in the record's words makes the sector UNCHECKED, named back by the
 * word, whatever else the industry says: "CBD e-commerce" is a CBD business
 * that sells online, not an e-commerce business, and "Financial technology"
 * is financial services however it is spelt. (A pharma or supplement word is
 * not here: it routes to the health and supplement packs through SECTOR_TABLE.)
 */
const UNSUPPORTED_SECTORS = [
  { sector: 'cannabis and CBD', rx: /\b(?:cbd|cannabi(?:s|noids?)|hemp|thc|marijuana|kratom|psychedelics?)\b/gi },
  { sector: 'alcohol', rx: /\b(?:alcohol(?:ic)?|beers?|brewer(?:y|ies)|wines?|winer(?:y|ies)|spirits|liquors?|distiller(?:y|ies)|vodka|whiske?y|gin|rum|tequila|ciders?)\b/gi },
  { sector: 'gambling', rx: /\b(?:gambling|betting|casinos?|sportsbooks?|lotter(?:y|ies)|poker|bingo|i-?gaming|wagering|bookmakers?)\b/gi },
  { sector: 'tobacco and nicotine', rx: /\b(?:tobacco|e-?cig(?:arette)?s?|cigarettes?|cigars?|nicotine|vap(?:e|es|ing|ors?)|hookahs?|shisha|snus)\b/gi },
  { sector: 'firearms and weapons', rx: /\b(?:firearms?|guns?|ammunition|ammo|weapons?)\b/gi },
  { sector: 'crypto and financial services', rx: /\b(?:crypto(?:currenc(?:y|ies))?|bitcoin|nfts?|web3|defi|blockchain|financ(?:e|ial)|fintech|bank(?:s|ing)?|lend(?:ing|ers?)|loans?|credit|insur(?:ance|ers?|tech)|invest(?:ing|ments?)|trading(?!\s+cards?)|forex|brokerages?|payday|mortgages?|wealth|pensions?|payments?)\b/gi },
];

/**
 * Words an industry may be made of that carry no sector rules here. A brand
 * is "no regulated sector" only when EVERY word of its industry is one of
 * these and at least one names a business (SAFE_SECTOR_WORD): one matching
 * token beside an unknown one ("Sneakers and nootropics") is not a
 * classification, it is a guess.
 */
const SAFE_SECTOR_WORD = /^(?:sneakers?|footwear|shoes?|apparel|clothing|fashion|sports|sporting|sportswear|streetwear|eyewear|jewel(?:le)?ry|accessories|watches|bags|luggage|news|publishing|publishers?|media|magazines?|journalism|streaming|entertainment|music|gaming|games|software|saas|apps?|technology|tech|electronics|devices|hardware|automotive|cars?|travel|hospitality|hotels?|airlines?|telecoms?|telecommunications|marketplaces?|e-?commerce|retail(?:ers?)?|furniture|goods|decor|homewares?|stationery|toys|books|education|edtech)$/i;
const QUALIFIER_WORD = /^(?:custom|customi[sz]ed|personali[sz]ed|bespoke|d2c|dtc|b2b|b2c|online|digital|consumer|general|business|regional|local|national|global|international|daily|weekly|luxury|premium|independent|sustainable|outdoor|hand-?made|home|lifestyle|content|events|services|products|platform|brands?|company|stores?|shops?|and|or|of|the|for|with|in|plus)$/i;

function sectorWords(text) {
  const s = String(text || '');
  const packs = [];
  const unsupported = [];
  const taken = [];
  for (const row of SECTOR_TABLE) {
    const g = new RegExp(row.rx.source, 'gi');
    let m;
    while ((m = g.exec(s)) !== null) {
      if (!packs.some((p) => p.id === row.id)) packs.push({ id: row.id, matched: m[0] });
      taken.push([m.index, m.index + m[0].length]);
    }
  }
  for (const row of UNSUPPORTED_SECTORS) {
    row.rx.lastIndex = 0;
    let m;
    while ((m = row.rx.exec(s)) !== null) {
      if (!unsupported.some((u) => u.term.toLowerCase() === m[0].toLowerCase())) unsupported.push({ term: m[0], sector: row.sector });
      taken.push([m.index, m.index + m[0].length]);
    }
  }
  const safe = [];
  const unknown = [];
  const words = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;
  let w;
  while ((w = words.exec(s)) !== null) {
    if (taken.some(([a, b]) => w.index >= a && w.index < b)) continue;
    if (SAFE_SECTOR_WORD.test(w[0])) safe.push(w[0]);
    else if (!QUALIFIER_WORD.test(w[0])) unknown.push(w[0]);
  }
  return { packs, unsupported, safe, unknown };
}

function sectorsOf(brand) {
  const declared = fieldOf(brand, 'compliance');
  const explicit = declared && Array.isArray(declared.sectors) ? declared.sectors.map((s) => String(s).trim()).filter(Boolean) : [];
  const stated = explicit.length
    ? explicit.map((v) => ({ v, where: `compliance.sectors "${v}"` }))
    : [[brand && brand.industry, fieldOf(brand, 'sector')].filter((x) => typeof x === 'string' && x.trim()).join(' / ')]
      .filter((v) => v.trim()).map((v) => ({ v, where: `industry "${v}"` }));
  const industry = explicit.length ? '' : (stated[0] ? stated[0].v : '');
  if (!stated.length) return { sectors: [], stated: false, unrecognised: [], unsupported: [], basis: 'unstated', industry: '' };
  // Unsupported regulated words first, then the packs, then every other word:
  // a value is known-safe only when nothing in it is unknown.
  const sectors = [];
  const unsupported = [];
  const unrecognised = [];
  const safe = [];
  for (const { v, where } of stated) {
    const id = v.toLowerCase();
    if (explicit.length && SECTORS.includes(id)) { sectors.push({ id, from: 'brand record: compliance.sectors' }); continue; }
    const r = sectorWords(v);
    for (const u of r.unsupported) {
      if (!unsupported.some((x) => x.term.toLowerCase() === u.term.toLowerCase())) unsupported.push(u);
      if (!unrecognised.includes(u.term)) unrecognised.push(u.term);
    }
    for (const p of r.packs) sectors.push({ id: p.id, from: `brand record: ${where} names "${p.matched}"` });
    if (r.unknown.length || (!r.packs.length && !r.unsupported.length && !r.safe.length)) {
      if (!unrecognised.includes(v)) unrecognised.push(v);
    } else if (!r.packs.length && !r.unsupported.length) safe.push({ where, words: r.safe });
  }
  const unique = sectors.filter((s, i) => sectors.findIndex((x) => x.id === s.id) === i);
  const from = explicit.length ? 'brand record: compliance.sectors' : `brand record: ${stated[0].where}`;
  if (unique.length) return { sectors: unique, stated: true, unrecognised, unsupported, basis: 'regulated', from: explicit.length ? from : unique[0].from, industry };
  if (unrecognised.length) return { sectors: [], stated: true, unrecognised, unsupported, basis: 'unrecognised', from, industry };
  const named = safe.map((x) => x.words.map((t) => `"${t}"`).join(', ')).join(', ');
  return { sectors: [], stated: true, unrecognised: [], unsupported: [], basis: 'no-regulated-sector', from: `${from} names ${named}`, industry };
}

function jurisdictionsFor(market) {
  const m = String(market || '').toUpperCase().trim();
  if (!NOT_ONE_COUNTRY.has(m)) {
    const j = JURISDICTIONS[m] || null;
    return { list: j ? [j] : [], from: `the asset's market (${m})`, unsupported: j ? null : m };
  }
  return {
    list: SHIPPED_JURISDICTIONS.slice(),
    from: m ? `the asset's market (${m}) is not one country, so every jurisdiction shipped here applies` : 'no market was stated, so every jurisdiction shipped here applies',
    unsupported: null,
  };
}

/* ── approved claims ─────────────────────────────────────────────────────── */

/**
 * A phrase as a pattern: case, curly or straight apostrophes, a hyphen or a
 * space, and runs of whitespace do not change what it says. `inflect` lets the
 * last word take an ordinary English ending ("transform" also finds
 * "transforms"), which is how a banned list is meant to be read.
 */
function claimRegex(text, opts) {
  const t = String(text || '').trim().replace(/[.!?;:,\s*†‡]+$/u, '');
  if (t.length < 3) return null;
  const parts = [];
  for (const ch of t) {
    if (/\s/.test(ch)) { if (parts[parts.length - 1] !== '\\s+') parts.push('\\s+'); continue; }
    if (ch === "'" || ch === '’' || ch === '‘') { parts.push("['’‘]?"); continue; }
    if (/[-‐‑–—]/.test(ch)) { parts.push('[-‐‑–—\\s]*'); continue; }
    parts.push(ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  }
  const tail = opts && opts.inflect && /[\p{L}]$/u.test(t) ? '(?:s|es|ed|d|ing)?' : '';
  return rx(`${B}${parts.join('')}${tail}${E}`);
}

function citationOf(c) {
  if (!c || typeof c !== 'object') return null;
  const source = typeof c.source === 'string' ? c.source.trim() : '';
  const url = typeof c.url === 'string' && /^https?:\/\//i.test(c.url.trim()) ? c.url.trim() : '';
  if (!source && !url) return null;
  return { source: source || url, url: url || null };
}

/**
 * The approved claims for this brand and market. Strings on the record's
 * `claims` are APPROVED (the operator put them on the record) but carry no
 * evidence citation; `approved_claims` entries carry their citation, an
 * optional register authorisation and an optional region scope.
 */
function approvedClaims(brand, extra, market) {
  const rows = [];
  const push = (raw, source) => {
    if (raw == null) return;
    const obj = typeof raw === 'string' ? { text: raw } : (typeof raw === 'object' ? raw : null);
    if (!obj || typeof obj.text !== 'string' || !obj.text.trim()) return;
    const regions = Array.isArray(obj.regions) ? obj.regions.map((r) => String(r).toUpperCase()) : null;
    rows.push({
      text: obj.text.trim(),
      source: obj.source && typeof obj.source === 'string' ? obj.source : source,
      citation: citationOf(obj.citation),
      register: typeof obj.register === 'string' && obj.register.trim() ? obj.register.trim() : null,
      regions,
    });
  };
  const claims = fieldOf(brand, 'claims');
  if (Array.isArray(claims)) claims.forEach((c, i) => push(c, `brand record: claims[${i}]`));
  const ac = fieldOf(brand, 'approved_claims');
  if (Array.isArray(ac)) ac.forEach((c, i) => push(c, `brand record: approved_claims[${i}]`));
  if (Array.isArray(extra)) extra.forEach((c, i) => push(c, (c && c.source) || `approved claims library [${i}]`));

  // One row per claim text WITHIN ONE REGIONAL SCOPE. The same words approved
  // for the US (on a study) and for the UK (on a register entry) are two
  // approvals with two kinds of evidence; merging them handed the UK the US
  // study and the US the UK register entry, which is the cross-region
  // transfer the operating contract forbids (master spec §1.5). Rows with an
  // identical scope merge (the cited copy wins); different scopes never do.
  const byKey = new Map();
  for (const r of rows) {
    const scope = r.regions ? [...new Set(r.regions.map((x) => JURISDICTIONS[x] || x))].sort().join(',') : '*';
    const key = `${scope}|${r.text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ')}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    byKey.set(key, {
      text: prev.text,
      source: prev.citation ? prev.source : r.source,
      citation: prev.citation || r.citation,
      register: prev.register || r.register,
      regions: prev.regions,
    });
  }
  const m = String(market || '').toUpperCase();
  const one = m && !NOT_ONE_COUNTRY.has(m);
  return [...byKey.values()].map((r) => Object.assign(r, {
    rx: claimRegex(r.text),
    // A region-scoped approval holds only in its own market. A send with no
    // single market may reach any of them, so only a market-wide approval
    // (no region scope) holds there.
    inRegion: !r.regions || (one && (r.regions.includes(m) || (JURISDICTIONS[m] && r.regions.some((x) => JURISDICTIONS[x] === JURISDICTIONS[m])))),
  })).filter((r) => r.rx);
}

/* ── context ─────────────────────────────────────────────────────────────── */

const REGULATED = new Set(SECTORS);

/**
 * Everything the linter needs to know about WHO is speaking and WHERE, read
 * once. Pass the result to lint() for every asset of a campaign.
 */
function contextFor(opts) {
  const o = opts || {};
  if (o.__compliance_ctx) return o;
  const brand = o.brand && typeof o.brand === 'object' ? o.brand : null;
  const market = String(o.market || '').toUpperCase().trim();
  const sel = brand ? sectorsOf(brand) : { sectors: [], stated: false };
  const jur = jurisdictionsFor(market);
  const sectorIds = sel.sectors.map((s) => s.id);
  const packs = PACKS.filter((p) => (!p.jurisdictions || p.jurisdictions.some((j) => jur.list.includes(j)))
    && (!p.sectors || p.sectors.some((s) => sectorIds.includes(s))));
  const regulated = sectorIds.some((s) => REGULATED.has(s));
  const banned = brand && fieldOf(brand, 'voice') && Array.isArray(fieldOf(brand, 'voice').banned)
    ? fieldOf(brand, 'voice').banned.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim())
    : [];
  const offer = o.offer && typeof o.offer === 'object' ? o.offer : {};
  const limits = [
    'The rule lexicon is English. Copy in another language is reported as not checked rather than passed.',
    'Detection is by phrase, not by meaning: an implied claim the tables do not list is not found, and a finding is a prompt for a human reading, not a ruling.',
  ];
  if (jur.unsupported) limits.push(`No regulatory pack is shipped for ${jur.unsupported}; only the brand-safety rules ran for this market.`);
  if (sel.unrecognised && sel.unrecognised.length) limits.push(`The record names ${sel.unrecognised.map((v) => `"${v}"`).join(', ')}, which no sector pack here covers or recognises, so its sector's rules were not checked.`);
  const offerOnRecord = {
    ends_at: offer.ends_at || offer.expires_at || offer.valid_until || null,
    stock: offer.stock != null && offer.stock !== '' ? offer.stock : (offer.inventory != null && offer.inventory !== '' ? offer.inventory : null),
  };
  return {
    __compliance_ctx: true,
    brand,
    brandName: brandNameOf(brand),
    market,
    jurisdictions: jur.list,
    sectors: sectorIds,
    regulated,
    packs: packs.map((p) => p.id),
    packLabels: packs.map((p) => p.label),
    banned,
    approved: approvedClaims(brand, o.approvedClaims || o.approved_claims, market),
    offer: offerOnRecord,
    // When the copy is READ: a slot's send date, a job's scheduled time, a
    // test's clock. Deadline lines are measured from it, not from build time.
    now: o.now != null && o.now !== '' ? o.now : null,
    selection: {
      brand: brand ? brandNameOf(brand) : null,
      market: market || null,
      jurisdictions: jur.list.map((j) => ({ code: j, from: jur.from })),
      sectors: sel.sectors,
      sector_stated: !!sel.stated,
      // regulated | no-regulated-sector | unrecognised | unstated, and where
      // that came from, so "no health pack" is a classification with a basis.
      sector_basis: sel.basis || (sel.stated ? 'regulated' : 'unstated'),
      sector_from: sel.from || (sel.sectors[0] && sel.sectors[0].from) || null,
      sector_unrecognised: sel.unrecognised || [],
      // A regulated sector named outright that no pack here covers, with the
      // word that named it: "CBD" in "CBD e-commerce".
      sector_unsupported: sel.unsupported || [],
      // The offer deadline and scarcity lines were measured against, as the
      // server read it (a campaign's record), so a reviewer sees what backed them.
      offer: offerOnRecord,
      packs: packs.map((p) => ({ id: p.id, label: p.label })),
    },
    unsupportedMarket: jur.unsupported,
    limits,
  };
}

const has = (ctx, pack) => ctx.packs.includes(pack);

/* ── span finding ────────────────────────────────────────────────────────── */

function allMatches(regexes, text) {
  const out = [];
  for (const r of [].concat(regexes)) {
    r.lastIndex = 0;
    let m;
    while ((m = r.exec(text)) !== null) {
      if (!m[0]) { r.lastIndex += 1; continue; }
      // A phrase is read inside one block: "insomnia" closing one cell and
      // "Cures" opening the next are not the phrase "insomnia cures".
      if (m[0].includes('\n')) { r.lastIndex = m.index + 1; continue; }
      out.push({ start: m.index, end: m.index + m[0].length, matched: m[0] });
    }
  }
  // Longest first at each start, then drop spans wholly inside another.
  out.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const s of out) {
    if (kept.some((k) => s.start >= k.start && s.end <= k.end)) continue;
    kept.push(s);
  }
  return kept;
}

function sentenceAround(text, start, end) {
  let s = start;
  while (s > 0 && !/[.!?\n]/.test(text[s - 1])) s -= 1;
  let e = end;
  while (e < text.length && !/[.!?\n]/.test(text[e])) e += 1;
  return { start: s, end: e, text: text.slice(s, e).trim() };
}

/**
 * Is the claim verb negated? Only the CLAUSE in front of it counts, and only
 * its last three words: "Not just a supplement: it cures anxiety" is a claim,
 * "it does not cure anxiety" is a negated one.
 */
function negated(text, span) {
  let s = span.start;
  while (s > 0 && !/[.!?\n:;,]/.test(text[s - 1])) s -= 1;
  const words = text.slice(s, span.start).trim().split(/\s+/).filter(Boolean).slice(-3).join(' ');
  return RX_NEGATOR.test(` ${words}`);
}

/** Replace a span with spaces of the same length so offsets survive. */
function blank(text, spans) {
  if (!spans.length) return text;
  const chars = text.split('');
  for (const s of spans) for (let i = s.start; i < s.end && i < chars.length; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  return chars.join('');
}

function disclaimerRegex(text) {
  const words = text.replace(/\.$/, '').split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  return new RegExp(`${words.join('\\s+')}\\.?`, 'giu');
}
const RX_DISCLAIMER_SINGULAR = disclaimerRegex(DISCLAIMER_SINGULAR);
const RX_DISCLAIMER_PLURAL = disclaimerRegex(DISCLAIMER_PLURAL);
const RX_DISCLAIMER_TAIL = disclaimerRegex('This product is not intended to diagnose, treat, cure, or prevent any disease.');

/* ── findings ────────────────────────────────────────────────────────────── */

function cites(ids) {
  return [].concat(ids).filter(Boolean).map((id) => Object.assign({ id }, SOURCES[id]));
}

function marker(field, subject, brandName) {
  const clean = (s) => String(s || '').replace(/[\[\]]/g, '').replace(/,/g, ';').replace(/\s+/g, ' ').trim().slice(0, 140);
  return `[DATA REQUIRED BEFORE LAUNCH: ${field}, ${clean(subject)}, ${clean(brandName)}]`;
}

function makeFinding(f, base) {
  const out = {
    id: base.id,
    pack: base.pack,
    severity: base.severity,
    title: base.title,
    field: f ? f.field : null,
    matched: f && base.span ? f.text.slice(base.span.start, base.span.end) : (base.matched || null),
    offsets: f && base.span ? { start: base.span.start, end: base.span.end } : null,
    raw_offsets: null,
    excerpt: null,
    citation: cites(base.sources),
    fix: base.fix,
  };
  if (f && base.span) {
    const s = base.span;
    if (f.map && f.map.length) {
      const rs = f.map[s.start];
      const re = f.map[Math.max(s.start, s.end - 1)];
      if (rs != null && re != null) {
        // The last character may have been decoded from an entity: end after it.
        const semi = f.raw[re] === '&' ? f.raw.indexOf(';', re) : -1;
        out.raw_offsets = { start: rs, end: semi > re && semi - re < 12 ? semi + 1 : re + 1 };
      }
    }
    const from = Math.max(0, s.start - 40);
    const to = Math.min(f.text.length, s.end + 40);
    out.excerpt = `${from > 0 ? '…' : ''}${f.text.slice(from, to).replace(/\n/g, ' ')}${to < f.text.length ? '…' : ''}`;
  }
  if (base.offer) out.offer = base.offer;
  if (base.marker) out.marker = base.marker;
  if (base.scope) out.scope = base.scope;
  if (base.merge) out.__merge = base.merge;
  if (base.related) out.related = base.related;
  return out;
}

/**
 * One problem, one finding. Two rules that object to the same words (a UK
 * supplement's disease claim breaks CAP 15.6.2 AND CAP 12.11), or that demand
 * the same fix inside one sentence, are reported once with every rule cited.
 */
function mergeFindings(list) {
  const groups = new Map();
  const order = [];
  for (const f of list) {
    const key = f.__merge ? `${f.field}|${f.severity}|${f.__merge}` : `${f.field}|${f.severity}|${f.offsets ? `${f.offsets.start}:${f.offsets.end}` : f.id}`;
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(f);
  }
  return order.map((key) => {
    const g = groups.get(key);
    const primary = Object.assign({}, g[0]);
    delete primary.__merge;
    if (g.length > 1) {
      const seen = new Set(primary.citation.map((c) => c.id));
      primary.also = [];
      for (const other of g.slice(1)) {
        primary.also.push({ id: other.id, pack: other.pack, title: other.title, fix: other.fix });
        for (const c of other.citation) if (!seen.has(c.id)) { seen.add(c.id); primary.citation.push(c); }
        if (primary.offsets && other.offsets && (other.offsets.start < primary.offsets.start || other.offsets.end > primary.offsets.end)) {
          // Keep the reported span covering every rule's words.
          const s = Math.min(primary.offsets.start, other.offsets.start);
          const e = Math.max(primary.offsets.end, other.offsets.end);
          primary.offsets = { start: s, end: e };
          if (primary.raw_offsets && other.raw_offsets) primary.raw_offsets = { start: Math.min(primary.raw_offsets.start, other.raw_offsets.start), end: Math.max(primary.raw_offsets.end, other.raw_offsets.end) };
          primary.__widen = true;
        }
      }
    }
    return primary;
  });
}

/* ── what a recorded offer backs ─────────────────────────────────────────── */

/**
 * The moment the copy is read at: an injected `now` (a slot's send date, a
 * scheduled time, or a test's clock), else the real clock. A date-only value
 * is the start of that day; `day` is the calendar date AS WRITTEN, so a time
 * zone in the record is respected rather than converted away.
 */
function refPoint(now) {
  if (now instanceof Date) return refPoint(now.getTime());
  if (typeof now === 'number' && Number.isFinite(now)) return { ms: now, day: new Date(now).toISOString().slice(0, 10) };
  const s = now == null ? '' : String(now).trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T00:00:00Z`) : Date.parse(s);
  if (!s || !Number.isFinite(ms)) return refPoint(Date.now());
  return { ms, day: /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(ms).toISOString().slice(0, 10) };
}
function endPoint(v) {
  const s = String(v == null ? '' : v).trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(`${s}T23:59:59Z`) : Date.parse(s);
  if (!s || !Number.isFinite(ms)) return null;
  return { ms, text: s, day: /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : new Date(ms).toISOString().slice(0, 10) };
}
const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * Does the recorded end date back THIS deadline line, read at `now`? "Today
 * only" needs an offer ending today, "48 hours only" one ending within 48
 * hours, "this weekend" one ending on the coming Saturday or Sunday; an offer
 * that has already ended backs nothing. A line with no measurable window
 * ("limited time") is backed by any end date still ahead.
 */
function deadlineAgainst(phrase, endsAt, now) {
  const end = endPoint(endsAt);
  if (!end) return { ok: false, why: `"${phrase}" states a deadline, and the end date on record ("${endsAt}") is not a date. Record the real end date, or remove the line.` };
  const ref = refPoint(now);
  const p = phrase.toLowerCase();
  const hours = (end.ms - ref.ms) / 36e5;
  const said = `the offer on record ends ${end.text}`;
  if (end.ms < ref.ms) return { ok: false, why: `"${phrase}" promises an offer that has already ended: ${said}, before this send (${ref.day}). Remove it.` };
  let ok = true;
  let need = '';
  const num = (rx) => Number((rx.exec(p) || [])[1]);
  if (/today|tonight|midnight|last day|final day/.test(p)) { ok = end.day === ref.day; need = `ending on ${ref.day}`; }
  else if (/tomorrow/.test(p)) { ok = end.day === addDays(ref.day, 1); need = `ending on ${addDays(ref.day, 1)}`; }
  else if (/\d+[\s-]*hours?/.test(p)) { const n = num(/(\d+)[\s-]*hours?/); ok = hours <= n; need = `ending within ${n} hours`; }
  else if (/\d+\s+minutes?/.test(p)) { const n = num(/(\d+)\s+minutes?/); ok = hours <= n / 60; need = `ending within ${n} minutes`; }
  else if (/\d+\s+days?/.test(p)) { const n = num(/(\d+)\s+days?/); ok = hours <= n * 24; need = `ending within ${n} days`; }
  else if (/final hours/.test(p)) { ok = hours <= 24; need = 'ending within 24 hours'; }
  else if (/weekend/.test(p)) { const wd = new Date(`${end.day}T00:00:00Z`).getUTCDay(); ok = hours <= 7 * 24 && (wd === 6 || wd === 0); need = 'ending on the coming Saturday or Sunday'; }
  else if (/this week|soon|clock is ticking|last chance/.test(p)) { ok = hours <= 7 * 24; need = 'ending within 7 days'; }
  return ok ? { ok: true } : { ok: false, why: `"${phrase}" needs an offer ${need}, and ${said} (read at ${ref.day}). Reword it to the real deadline, or remove it.` };
}

/** Does the recorded stock back THIS line? A number must BE the number on record. */
function stockAgainst(phrase, stock) {
  const n = Number(String(stock).replace(/[^\d.]/g, ''));
  const m = /(\d[\d,]*)/.exec(phrase);
  if (m) {
    const said = Number(m[1].replace(/,/g, ''));
    if (String(stock).trim() !== '' && Number.isFinite(n) && said === n) return { ok: true };
    return { ok: false, why: `"${phrase}" states ${said} left, and the stock on record is ${stock}. Use the recorded number, or remove the line.` };
  }
  return { ok: false, warn: true, why: `"${phrase}" describes stock in words; the record states ${stock}, and whether the words are true of that number cannot be measured. Confirm it, or state the number.` };
}

/* ── the linter ──────────────────────────────────────────────────────────── */

/**
 * The approved claim covering a span. Several may (a market-wide uncited copy
 * and a market-scoped cited one): the one carrying what this rule needs, a
 * `citation` or a `register` entry, is preferred, so a cited approval is never
 * hidden behind an uncited one with the same words.
 */
function approvedCovering(f, span, need) {
  const all = f.approvedSpans.filter((a) => span.start >= a.start && span.end <= a.end).map((a) => a.claim);
  if (!all.length) return null;
  return (need && all.find((c) => c[need])) || all.find((c) => c.citation) || all[0];
}

function outOfRegionClaim(ctx, text, span) {
  for (const c of ctx.approved) {
    if (c.inRegion) continue;
    c.rx.lastIndex = 0;
    let m;
    while ((m = c.rx.exec(text)) !== null) {
      if (span.start >= m.index && span.end <= m.index + m[0].length) return c;
    }
  }
  return null;
}

const overlaps = (s, list) => list.some((o) => s.start < o.end && s.end > o.start);

/** The brand's own handles, so its footer's "@brand" is not read as an endorser. */
function ownHandles(brand) {
  const out = new Set();
  const add = (v) => { const s = String(v || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9_.]/g, ''); if (s) out.add(s); };
  if (!brand) return out;
  add(brand.slug); add(brand.name);
  const social = fieldOf(brand, 'social');
  const vals = social && typeof social === 'object' ? Object.values(social) : [];
  for (const v of vals) {
    const s = String(v || '');
    const m = /(?:instagram|tiktok|x|twitter|threads|youtube|facebook)\.[a-z.]+\/@?([A-Za-z0-9_.]+)/i.exec(s);
    add(m ? m[1] : s);
  }
  return out;
}

/**
 * Lint one asset.
 *
 * @param {Object|string} asset   an asset (email, ad, landing page), a dispatch payload, or plain copy
 * @param {Object} opts           { brand, market, approvedClaims, offer } or a context from contextFor()
 * @returns {{ok:boolean, verdict:'pass'|'warn'|'block', findings:Array, blocking:number, warnings:number,
 *            packs:string[], selection:Object, matched_claims:Array, limits:string[], fields:number}}
 */
function lint(asset, opts) {
  const ctx = contextFor(opts);
  const fields = fieldsOf(asset);
  const raw = [];
  const matchedClaims = [];
  const name = ctx.brandName;
  const usFtc = has(ctx, 'us.ftc');
  const ukCap = has(ctx, 'uk.cap');
  const usHealth = has(ctx, 'us.fda-ftc.health');
  const uk15 = has(ctx, 'uk.cap15');
  const uk12 = has(ctx, 'uk.cap12');
  const supplement = ctx.sectors.includes('dietary_supplement');
  const substantiation = ['spec.1.10', usFtc && 'ftc.substantiation', ukCap && 'cap.3.7'].filter(Boolean);
  const handles = ownHandles(ctx.brand);
  const noteMatched = (claim, why) => {
    if (!matchedClaims.some((c) => c.text === claim.text)) {
      matchedClaims.push({ text: claim.text, source: claim.source, citation: claim.citation, register: claim.register, for: why });
    }
  };

  /* ── what could not be checked, said rather than passed ───────────────── */
  if (!ctx.brand) {
    raw.push(makeFinding(null, { id: 'compliance.no_brand', pack: 'generic', severity: 'WARN', title: 'No brand record', scope: 'selection', sources: ['spec.1.9'], fix: 'Lint this asset as an active brand: without the record, its banned phrases, approved claims and sector rules could not be read. This is not a pass.' }));
  } else if (!ctx.selection.sector_stated) {
    raw.push(makeFinding(null, { id: 'compliance.sector_unknown', pack: 'generic', severity: 'WARN', title: 'Sector unknown', scope: 'selection', sources: ['spec.1.9'], fix: `${name}'s record states no industry, so the health, food and supplement rules could not be selected. Set the industry (or compliance.sectors) on the brand record. Only the brand-safety rules ran; this is not a pass.` }));
  }
  // A sector the record STATES but nothing here recognises is not a
  // classification: "Nootropic gummies" read as "no health pack applies" would
  // pass "Cures anxiety". Nor is a regulated sector no pack here covers
  // ("CBD e-commerce", "Financial technology"): both are unchecked, said, and
  // named by the word that named them.
  if (ctx.brand && ctx.selection.sector_unrecognised.length) {
    const unsup = ctx.selection.sector_unsupported || [];
    const unknown = ctx.selection.sector_unrecognised.filter((v) => !unsup.some((u) => u.term === v));
    const said = [];
    if (unsup.length) said.push(`${unsup.map((u) => (u.term.toLowerCase() === u.sector ? `"${u.term}"` : `"${u.term}" (${u.sector})`)).join(', ')}: regulated, and no rule pack shipped here covers ${unsup.length > 1 ? 'them' : 'it'}`);
    if (unknown.length) said.push(`${unknown.map((v) => `"${v}"`).join(', ')}: not a sector this gate can classify`);
    raw.push(makeFinding(null, {
      id: 'compliance.sector_unrecognised', pack: 'generic', severity: 'WARN',
      title: unknown.length ? 'Sector not recognised' : 'Regulated sector not covered',
      scope: 'selection', sources: ['spec.1.9'],
      fix: `${name}'s record names ${said.join('; ')}. The rules that sector is bound by were NOT checked, so have this asset reviewed against them before it ships. If the record's words are wrong, or a shipped sector applies, state the brand's sectors in compliance.sectors (${SECTORS.join(', ')}, or the industry in plain words). This is not a pass.`,
    }));
  }
  if (ctx.regulated && ctx.unsupportedMarket) {
    raw.push(makeFinding(null, { id: 'compliance.jurisdiction_unsupported', pack: 'generic', severity: 'WARN', title: 'No regulatory pack for this market', scope: 'selection', sources: ['spec.1.9'], fix: `${name} is in a regulated sector (${ctx.sectors.join(', ')}) and no regulatory rule pack is shipped for ${ctx.unsupportedMarket}. Only the brand-safety rules ran; have this asset reviewed against ${ctx.unsupportedMarket}'s rules before it is published.` }));
  }
  if (ctx.regulated && fields.length) {
    const words = fields.map((f) => f.text).join(' ').toLowerCase().match(/[\p{L}'’]+/gu) || [];
    if (words.length >= 8) {
      const hits = words.filter((w) => ENGLISH_FUNCTION_WORDS.has(w.replace(/’/g, "'"))).length;
      if (hits / words.length < 0.05) {
        raw.push(makeFinding(null, { id: 'compliance.language_unchecked', pack: 'generic', severity: 'WARN', title: 'Copy not checked: not English', scope: 'selection', sources: ['spec.1.9'], fix: 'This copy does not read as English and the health-claim rules are written in English, so they could not be applied. Have it reviewed in its own language before it is published. This is not a pass.' }));
      }
    }
  }

  /* ── the FDA disclaimer, wherever it sits in the asset ────────────────── */
  const disclaimers = [];
  for (const f of fields) {
    for (const [r, plural] of [[RX_DISCLAIMER_PLURAL, true], [RX_DISCLAIMER_SINGULAR, false]]) {
      r.lastIndex = 0;
      let m;
      while ((m = r.exec(f.text)) !== null) {
        let k = m.index - 1;
        while (k >= 0 && f.text[k] === ' ') k -= 1;
        const sym = k >= 0 && LINK_SYMBOLS.includes(f.text[k]) ? f.text[k] : null;
        disclaimers.push({ field: f.field, start: m.index, end: m.index + m[0].length, plural, sym });
      }
    }
  }

  const sfClaims = [];
  const disclosedFor = disclosureBySurface(fields);
  const generalBenefit = [];

  for (const f of fields) {
    // What is not copy is not judged: a launch marker, and the disclaimer
    // itself (it names "diagnose, treat, cure, or prevent any disease").
    const masks = [];
    RX_MARKER.lastIndex = 0;
    let mm;
    while ((mm = RX_MARKER.exec(f.text)) !== null) masks.push({ start: mm.index, end: mm.index + mm[0].length });
    for (const d of disclaimers) if (d.field === f.field) masks.push(d);
    RX_DISCLAIMER_TAIL.lastIndex = 0;
    while ((mm = RX_DISCLAIMER_TAIL.exec(f.text)) !== null) masks.push({ start: mm.index, end: mm.index + mm[0].length });
    const text = blank(f.text, masks);

    f.approvedSpans = [];
    for (const claim of ctx.approved) {
      if (!claim.inRegion) continue;
      claim.rx.lastIndex = 0;
      let m;
      while ((m = claim.rx.exec(text)) !== null) f.approvedSpans.push({ start: m.index, end: m.index + m[0].length, claim });
    }

    /* 1. the brand's own banned phrases */
    const bannedSpans = [];
    for (const phrase of ctx.banned) {
      const r = claimRegex(phrase, { inflect: true });
      if (!r) continue;
      for (const span of allMatches([r], text)) {
        bannedSpans.push(span);
        raw.push(makeFinding(f, { id: 'generic.banned_phrase', pack: 'generic', severity: 'BLOCK', title: 'Banned phrase', span, sources: ['brand.banned'], fix: `Remove or reword "${span.matched}": "${phrase}" is on ${name}'s own banned list.` }));
      }
    }

    /* 2. disease claims */
    const diseaseSpans = [];
    if (usHealth || uk15 || uk12) {
      for (const span of allMatches(RX_DISEASE, text)) {
        diseaseSpans.push(span);
        const neg = negated(text, span);
        const merge = `disease@${span.start}:${span.end}`;
        if (usHealth) {
          const src = supplement ? ['cfr21.101.93g', 'usc21.343r6', 'ftc.health'] : ['usc21.321g1', 'ftc.health'];
          raw.push(makeFinding(f, neg
            ? { id: 'us.fda.disease_reference', pack: 'us.fda-ftc.health', severity: 'WARN', title: 'Disease named beside a negated treatment verb', span, merge, sources: src, fix: `"${span.matched}" is negated, but it still puts a disease next to ${name}'s product, and a statement that otherwise suggests an effect on a disease is read as a disease claim. Reword it so no disease is named, or have it reviewed.` }
            : { id: 'us.fda.disease_claim', pack: 'us.fda-ftc.health', severity: 'BLOCK', title: 'Disease claim', span, merge, sources: src, fix: `Remove "${span.matched}". ${supplement ? 'A dietary supplement may not claim to diagnose, treat, cure, mitigate or prevent a disease, and no disclaimer or citation makes this claim permissible.' : 'A product presented as diagnosing, treating, curing or preventing a disease is regulated as a drug.'}` }));
        }
        if (uk15) {
          raw.push(makeFinding(f, neg
            ? { id: 'uk.cap15.disease_reference', pack: 'uk.cap15', severity: 'WARN', title: 'Disease named beside a negated treatment verb', span, merge, sources: ['cap.15.6.2', 'reg1169.7.3'], fix: `"${span.matched}" is negated, but a statement that implies a food affects a disease is not acceptable either. Reword it so no disease is named.` }
            : { id: 'uk.cap15.disease_claim', pack: 'uk.cap15', severity: 'BLOCK', title: 'Food or supplement claimed to prevent, treat or cure a disease', span, merge, sources: ['cap.15.6.2', 'reg1169.7.3'], fix: `Remove "${span.matched}". A food or food supplement may not claim to prevent, treat or cure a human disease, and no approval makes it acceptable.` }));
        }
        if (uk12) {
          raw.push(makeFinding(f, neg
            ? { id: 'uk.cap12.disease_reference', pack: 'uk.cap12', severity: 'WARN', title: 'Disease named beside a negated treatment verb', span, merge, sources: ['cap.12.11'], fix: `"${span.matched}" is negated, but it still associates a medical condition with an unlicensed product. Reword it so no condition is named.` }
            : { id: 'uk.cap12.medicinal_claim', pack: 'uk.cap12', severity: 'BLOCK', title: 'Medicinal claim for an unlicensed product', span, merge, sources: /diagnos/i.test(span.matched) ? ['cap.12.11', 'cap.12.2'] : ['cap.12.11'], fix: `Remove "${span.matched}". Medicinal claims may be made only for a licensed medicinal product or a marked medical device; if this product holds a licence, record it in the override reason.` }));
        }
      }
    }
    const inDisease = (s) => overlaps(s, diseaseSpans);

    /* 3. health benefit and weight-loss claims */
    const healthClaim = (span, kind) => {
      const sent = sentenceAround(text, span.start, span.end);
      const covering = approvedCovering(f, span, 'citation');
      const registered = approvedCovering(f, span, 'register');
      const merge = `cite@${sent.start}`;
      const what = kind === 'weight' ? 'a weight-loss claim' : 'a health claim';
      if (usHealth) {
        if (covering && covering.citation) noteMatched(covering, 'health claim substantiation');
        else raw.push(makeFinding(f, { id: 'us.ftc.health_claim_unsubstantiated', pack: 'us.fda-ftc.health', severity: 'BLOCK', title: kind === 'weight' ? 'Weight-loss claim without cited substantiation' : 'Health claim without cited substantiation', span, merge, sources: ['ftc.health'], marker: marker('approved claim + citation', sent.text, name), fix: `"${span.matched}" is ${what}. It needs competent and reliable scientific evidence: use it only as an approved claim, word for word, that carries its citation. ${covering ? `${covering.source} approves the words but cites no evidence.` : `Nothing on ${name}'s record approves it.`}` }));
      }
      if (uk15) {
        const amount = kind === 'weight' && RX_WL_AMOUNT.test(sent.text);
        if (amount) {
          let s0 = sent.start;
          while (s0 < sent.end && /\s/.test(text[s0])) s0 += 1;
          raw.push(makeFinding(f, { id: 'uk.cap15.weight_loss_rate', pack: 'uk.cap15', severity: 'BLOCK', title: 'Rate or amount of weight loss', span: { start: s0, end: sent.end }, sources: ['cap.15.6.6', 'reg1924.12b'], fix: 'Remove the rate or amount of weight loss. A food or supplement may not say how much or how fast weight is lost, and no approval makes it acceptable.' }));
        } else if (registered && registered.register) noteMatched(registered, 'GB NHC Register authorisation');
        else raw.push(makeFinding(f, { id: 'uk.cap15.health_claim_unauthorised', pack: 'uk.cap15', severity: 'BLOCK', title: 'Health claim not on the GB NHC Register', span, merge, sources: ['cap.15.1.1', 'reg1924.10.1', 'gb.nhc'], marker: marker('GB NHC Register authorisation', sent.text, name), fix: `"${span.matched}" is ${what}. In the UK only claims authorised on the GB NHC Register may be used: flag it for approval, or use an authorised wording recorded on ${name}'s approved claims with its register entry.` }));
      }
      if (uk12 && !uk15) {
        if (covering && covering.citation) noteMatched(covering, 'health claim evidence');
        else raw.push(makeFinding(f, { id: 'uk.cap12.unsubstantiated_health_claim', pack: 'uk.cap12', severity: 'BLOCK', title: 'Health claim without evidence on record', span, merge, sources: ['cap.12.1', 'cap.3.7'], marker: marker('approved claim + citation', sent.text, name), fix: `"${span.matched}" is ${what}, an objective claim that needs evidence, if relevant trials on people, held before publication. Use it only as an approved claim with its citation.` }));
      }
    };
    if (usHealth || uk15 || uk12) {
      for (const span of allMatches(RX_SF, text)) {
        if (inDisease(span)) continue;
        // `text` is the field as READ (the disclaimer blanked out); the
        // linkage check needs the field as WRITTEN, where the disclaimer is.
        sfClaims.push({ field: f.field, start: span.start, end: span.end, matched: span.matched, text: f.text });
        healthClaim(span, 'function');
      }
      for (const span of allMatches(RX_WL, text)) {
        if (inDisease(span)) continue;
        healthClaim(span, 'weight');
      }
    }
    if (uk15) for (const span of allMatches([RX_GENERAL_BENEFIT], text)) generalBenefit.push({ f, span });

    /* 4. claims that need an approved source */
    const claimSpan = (span, kind) => {
      if (inDisease(span)) return;
      const sent = sentenceAround(text, span.start, span.end);
      const covering = approvedCovering(f, span, kind === 'clinical' ? 'citation' : null);
      const merge = `cite@${sent.start}`;
      if (kind === 'clinical') {
        if (covering && covering.citation) { noteMatched(covering, 'clinical claim'); return; }
        const away = covering ? null : outOfRegionClaim(ctx, text, span);
        raw.push(makeFinding(f, {
          id: 'generic.uncited_clinical_claim', pack: 'generic', severity: 'BLOCK',
          title: covering ? 'Clinical claim approved without a citation' : 'Clinical or scientific claim not in the approved list',
          span, merge,
          sources: ['spec.1.1', 'spec.1.9'].concat(usHealth ? ['ftc.health'] : (usFtc ? ['ftc.substantiation'] : []), uk12 ? ['cap.12.1'] : (ukCap ? ['cap.3.7'] : [])),
          marker: marker('approved claim + citation', sent.text, name),
          fix: covering
            ? `"${span.matched}" matches ${covering.source}, which carries no citation. Add the study or source it rests on to the approved claim, or remove the claim.`
            : (away
              ? `"${span.matched}" is approved only for ${away.regions.join(', ')} (${away.source}); a claim approved for one market may not be used in ${ctx.market || 'another'} without its own approval.`
              : `"${span.matched}" is a clinical or scientific claim. Use it only as an approved claim, word for word, with its citation; nothing on ${name}'s record approves it.`),
        }));
        return;
      }
      if (covering) { noteMatched(covering, kind); return; }
      const soft = kind === 'soft-superlative';
      const elsewhere = outOfRegionClaim(ctx, text, span);
      const sources = kind === 'superlative' || soft ? substantiation.concat(['spec.1.1']) : ['spec.1.1', 'spec.1.9'].concat(usFtc ? ['ftc.substantiation'] : [], ukCap ? ['cap.3.7'] : []);
      const titles = { superlative: 'Superlative without substantiation', 'soft-superlative': 'Superlative that may be a claim', credential: 'Unverified credential or award', attribute: 'Unverified product attribute', statistic: 'Unverified statistic' };
      raw.push(makeFinding(f, {
        id: kind === 'superlative' ? 'generic.objective_superlative' : (soft ? 'generic.unqualified_absolute' : 'generic.unverified_claim'),
        pack: 'generic', severity: soft ? 'WARN' : 'BLOCK',
        title: titles[kind], span, merge: soft ? undefined : merge, sources,
        marker: soft ? undefined : marker('approved claim + citation', sent.text, name),
        fix: elsewhere
          ? `"${span.matched}" is approved only for ${elsewhere.regions.join(', ')} (${elsewhere.source}); it may not be used in ${ctx.market || 'this market'} without its own approval.`
          : (soft
            ? `"${span.matched}" is a claim if it is about ${name}. If it is, use an approved claim word for word; if it reports on something else, leave it.`
            : `"${span.matched}" is an objective claim with nothing approved behind it. Use it only as it appears, word for word, in ${name}'s approved claims, or remove it.`),
      }));
    };
    for (const span of allMatches(RX_CLINICAL, text)) claimSpan(span, 'clinical');
    const clinicalHere = raw.filter((x) => x.field === f.field && x.id === 'generic.uncited_clinical_claim' && x.offsets).map((x) => x.offsets);
    for (const span of allMatches(RX_STATISTIC, text)) {
      if (overlaps(span, clinicalHere)) continue;
      if (OFFER_BEFORE.test(text.slice(Math.max(0, span.start - 12), span.start))) continue;
      claimSpan(span, 'statistic');
    }
    for (const span of allMatches(RX_CREDENTIAL, text)) claimSpan(span, 'credential');
    if (ctx.regulated) for (const span of allMatches(RX_ATTRIBUTE, text)) claimSpan(span, 'attribute');
    const supers = allMatches(RX_SUPERLATIVE, text);
    for (const span of supers) claimSpan(span, 'superlative');
    const softSupers = allMatches(RX_SUPERLATIVE_SOFT, text).filter((s) => !overlaps(s, supers));
    for (const span of softSupers) claimSpan(span, 'soft-superlative');

    /* 5. guarantees and an unqualified "best" */
    // A guaranteed OUTCOME is prohibited outright (master spec §1.9), so an
    // approval does not suppress it: "Guaranteed weight loss" on the approved
    // list, even with a citation, is still a promise nobody can keep.
    const outcomes = allMatches(RX_GUARANTEED_OUTCOME, text);
    for (const span of outcomes) {
      const listed = approvedCovering(f, span);
      raw.push(makeFinding(f, { id: 'generic.guaranteed_outcome', pack: 'generic', severity: 'BLOCK', title: 'Guaranteed outcome', span, sources: ['spec.1.9'].concat(usFtc ? ['ftc.substantiation'] : [], ukCap ? ['cap.3.7'] : []), fix: `Remove "${span.matched}". An outcome may not be promised as guaranteed${listed ? `, and its place on the approved list (${listed.source}) does not change that: remove it from the list too` : ''}.` }));
    }
    // A customer's "best ... I have owned" inside quotation marks is that
    // customer's opinion; the endorsement rules below are what apply to it.
    const quoted = allMatches([/[“"][^”"\n]{3,400}[”"]/g], text);
    for (const span of allMatches([RX_BEST, RX_GUARANTEE], text)) {
      if (overlaps(span, outcomes) || overlaps(span, supers) || overlaps(span, softSupers) || overlaps(span, bannedSpans) || approvedCovering(f, span)) continue;
      const isGuarantee = /^guarantee/i.test(span.matched);
      if (!isGuarantee && (BEST_IDIOM.test(sentenceAround(text, span.start, span.end).text) || overlaps(span, quoted))) continue;
      raw.push(makeFinding(f, {
        id: 'generic.unqualified_absolute', pack: 'generic', severity: 'WARN',
        title: isGuarantee ? 'Guarantee with no terms on record' : 'Unqualified "best"',
        span, sources: isGuarantee ? ['spec.1.1', 'spec.1.9'] : substantiation,
        fix: isGuarantee
          ? `"${span.matched}" promises a guarantee. Confirm the guarantee and its terms are approved for ${name}, or remove it.`
          : `"${span.matched}" reads as a claim. Keep it only where it is plainly opinion, never as a measurable comparison; otherwise use an approved claim.`,
      }));
    }

    /* 6. urgency the offer data does not back */
    for (const [regexes, needs] of [[RX_DEADLINE, 'ends_at'], [RX_SCARCITY, 'stock']]) {
      for (const span of allMatches(regexes, text)) {
        if (overlaps(span, bannedSpans)) continue;
        const what = needs === 'ends_at' ? 'offer end date' : 'stock level';
        const recorded = ctx.offer[needs] != null && ctx.offer[needs] !== '' ? ctx.offer[needs] : null;
        if (recorded == null) {
          raw.push(makeFinding(f, { id: 'generic.unbacked_urgency', pack: 'generic', severity: 'BLOCK', title: needs === 'ends_at' ? 'Deadline with no end date on record' : 'Scarcity with no stock level on record', span, sources: ['spec.1.1'], marker: marker(`${what} behind "${span.matched}"`, ctx.market || 'all markets', name), fix: `"${span.matched}" states ${needs === 'ends_at' ? 'a deadline' : 'a stock level'} that no ${what} on this campaign's offer supports. Remove it, or record the real ${what} on the offer.` }));
          continue;
        }
        // A value on record backs only what it SAYS: the copy is measured
        // against it, never waved through because some value exists.
        const verdict = needs === 'ends_at' ? deadlineAgainst(span.matched, recorded, ctx.now) : stockAgainst(span.matched, recorded);
        if (verdict.ok) continue;
        raw.push(makeFinding(f, {
          id: 'generic.unbacked_urgency', pack: 'generic', severity: verdict.warn ? 'WARN' : 'BLOCK',
          title: verdict.warn ? 'Scarcity wording that a stock number cannot confirm' : (needs === 'ends_at' ? 'Deadline the offer on record does not support' : 'Stock count that is not the one on record'),
          span, sources: ['spec.1.1'], fix: verdict.why,
        }));
      }
    }

    /* 7. endorsements */
    if (usFtc || ukCap) {
      // A disclosure counts only on the surface this field ships on: a
      // post's "#ad" in its hashtags covers its caption, another variant's
      // "Sponsored" or a search snippet's does not.
      const disclosed = disclosedFor(f);
      const testimonials = [];
      RX_TESTIMONIAL.lastIndex = 0;
      let m;
      while ((m = RX_TESTIMONIAL.exec(text)) !== null) testimonials.push({ start: m.index, end: m.index + m[0].length, matched: m[0], quote: m[1] });
      const creators = allMatches([RX_INFLUENCER, RX_ENDORSED_BY], text);
      RX_HANDLE.lastIndex = 0;
      while ((m = RX_HANDLE.exec(text)) !== null) {
        if (!handles.has(m[1].toLowerCase()) && !overlaps({ start: m.index, end: m.index + m[0].length }, creators)) creators.push({ start: m.index, end: m.index + m[0].length, matched: m[0] });
      }
      creators.sort((a, b) => a.start - b.start);
      if (!disclosed && usFtc && (testimonials.length || creators.length)) {
        const span = [testimonials[0], creators[0]].filter(Boolean).sort((a, b) => a.start - b.start)[0];
        raw.push(makeFinding(f, { id: 'us.ftc.endorsement_disclosure', pack: 'us.ftc', severity: 'WARN', title: 'Endorsement with no connection disclosed', span, merge: `endorsement@${span.start}`, sources: ['cfr16.255.5'], fix: `If this endorser was paid, given free product, or has any business or family relationship with ${name}, disclose it clearly and conspicuously beside the endorsement (for example "Paid partnership" or "#ad"). Whether a connection exists cannot be told from the copy.` }));
      }
      if (!disclosed && ukCap && creators.length) {
        raw.push(makeFinding(f, { id: 'uk.cap.endorsement_identifiable', pack: 'uk.cap', severity: 'WARN', title: 'Creator content not labelled as marketing', span: creators[0], sources: ['cap.2'], fix: 'Where a creator or ambassador was paid or given a perk for this content, label it up front as an ad (for example "#ad"), so it is obviously identifiable as marketing.' }));
      }
      if (usHealth) {
        for (const t of testimonials) {
          if (!RX_RESULT_TESTIMONY.test(t.quote)) continue;
          // A different fix from the disclosure above, so its own finding.
          raw.push(makeFinding(f, { id: 'us.ftc.testimonial_typicality', pack: 'us.fda-ftc.health', severity: 'WARN', title: 'Results testimonial', span: t, merge: `typicality@${t.start}`, sources: ['cfr16.255.2b', 'ftc.health'], fix: 'A customer\'s result is read as what buyers will generally achieve. Hold evidence that it is typical, or disclose the generally expected results beside it.' }));
        }
      }
    }
  }

  /* a general benefit needs a specific authorised claim beside it (UK) */
  if (uk15 && generalBenefit.length && !matchedClaims.some((c) => c.register)) {
    const { f, span } = generalBenefit[0];
    raw.push(makeFinding(f, { id: 'uk.cap15.general_benefit', pack: 'uk.cap15', severity: 'WARN', title: 'General health benefit with no authorised claim beside it', span, sources: ['reg1924.10.3', 'cap.15.1.1'], fix: `"${span.matched}" refers to a general health benefit, which may be used only beside a specific health claim authorised on the GB NHC Register. Add one from ${name}'s approved claims, or remove it.` }));
  }

  /* 8. the structure/function disclaimer (US dietary supplements) */
  if (usHealth && supplement && sfClaims.length) {
    const statements = new Set(sfClaims.map((c) => sentenceAround(c.text, c.start, c.end).text.toLowerCase()));
    const offerText = statements.size > 1 ? DISCLAIMER_PLURAL : DISCLAIMER_SINGULAR;
    if (!disclaimers.length) {
      let paraphrase = null;
      for (const f of fields) {
        RX_DISCLAIMER_PARAPHRASE.lastIndex = 0;
        const m = RX_DISCLAIMER_PARAPHRASE.exec(f.text);
        if (m) { paraphrase = m[0]; break; }
      }
      const first = sfClaims[0];
      const f = fields.find((x) => x.field === first.field);
      raw.push(makeFinding(f, {
        id: paraphrase ? 'us.fda.sf_disclaimer_wording' : 'us.fda.sf_disclaimer_missing',
        pack: 'us.fda-ftc.health', severity: 'BLOCK',
        title: paraphrase ? 'Disclaimer paraphrased, not as prescribed' : 'Structure/function claim without the FDA disclaimer',
        span: first, sources: ['cfr21.101.93c', 'usc21.343r6'],
        offer: offerText,
        related: sfClaims.map((c) => ({ field: c.field, matched: c.matched, offsets: { start: c.start, end: c.end } })),
        fix: paraphrase
          ? `The disclaimer is paraphrased ("${paraphrase}"). Its wording is prescribed: replace it with the exact text offered here, directly after the statement or linked to it with an asterisk.`
          : `${statements.size} structure/function statement(s), starting with "${first.matched}", need the FDA disclaimer. Add the exact text offered here directly after the statement, or end each statement with * and put * immediately before the disclaimer.`,
      }));
    } else {
      const symbolled = disclaimers.find((d) => d.sym);
      for (const c of sfClaims) {
        const sent = sentenceAround(c.text, c.start, c.end);
        const tail = c.text.slice(c.end, Math.min(c.text.length, sent.end + 2));
        const symAt = [...tail].find((ch) => LINK_SYMBOLS.includes(ch)) || null;
        if (symAt && disclaimers.some((d) => d.sym === symAt)) continue;
        // Adjacent: the disclaimer follows the statement with nothing between.
        let k = sent.end;
        while (k < c.text.length && /[\s.!?*†‡§]/.test(c.text[k])) k += 1;
        if (disclaimers.some((d) => d.field === c.field && d.start === k)) continue;
        const f = fields.find((x) => x.field === c.field);
        raw.push(makeFinding(f, { id: 'us.fda.sf_disclaimer_unlinked', pack: 'us.fda-ftc.health', severity: 'BLOCK', title: 'Disclaimer present but not linked to the statement', span: c, sources: ['cfr21.101.93c'], offer: disclaimers.some((d) => d.plural) ? DISCLAIMER_PLURAL : DISCLAIMER_SINGULAR, fix: `"${c.matched}" is not linked to the disclaimer. End the statement with ${symbolled ? symbolled.sym : '*'} and put the same symbol immediately before the disclaimer, or place the disclaimer directly after the statement.` }));
      }
      if (statements.size > 1 && !disclaimers.some((d) => d.plural) && disclaimers.length < statements.size) {
        const d0 = disclaimers[0];
        const f = fields.find((x) => x.field === d0.field);
        raw.push(makeFinding(f, { id: 'us.fda.sf_disclaimer_plural', pack: 'us.fda-ftc.health', severity: 'WARN', title: 'One singular disclaimer for several statements', span: d0, sources: ['cfr21.101.93c'], offer: DISCLAIMER_PLURAL, fix: `${statements.size} statements share one singular disclaimer. Give each statement its own, or use the plural form offered here.` }));
      }
    }
  }

  const findings = mergeFindings(raw).map((x) => {
    if (x.__widen) {
      const f = fields.find((ff) => ff.field === x.field);
      if (f && x.offsets) x.matched = f.text.slice(x.offsets.start, x.offsets.end);
      delete x.__widen;
    }
    return x;
  });
  const blocking = findings.filter((x) => x.severity === 'BLOCK').length;
  const warnings = findings.filter((x) => x.severity === 'WARN').length;
  return {
    ok: blocking === 0,
    verdict: blocking ? 'block' : (warnings ? 'warn' : 'pass'),
    findings,
    blocking,
    warnings,
    packs: ctx.packs.slice(),
    selection: ctx.selection,
    matched_claims: matchedClaims,
    limits: ctx.limits.slice(),
    fields: fields.length,
  };
}

/* ── the writer's brief: the same rules, stated before the copy exists ────── */

/**
 * The compliance block for a copywriting prompt. Built from the SAME context
 * the linter uses, so the writer and the checker cannot disagree about which
 * rules apply, which claims are approved, or what the disclaimer says.
 */
function brief(opts) {
  const ctx = contextFor(opts);
  const name = ctx.brandName;
  const cite = (ids) => `[${ids.map((id) => SOURCES[id].cite).join('; ')}]`;
  const lines = [
    `COMPLIANCE for ${name}${ctx.market ? ` in ${ctx.market}` : ''}: the finished asset is linted against these rules and a breach BLOCKS publishing. Rule packs: ${ctx.packLabels.join('; ')}.`,
  ];
  if (ctx.banned.length) lines.push(`- Never write: ${ctx.banned.map((b) => `"${b}"`).join(', ')}. ${cite(['brand.banned'])}`);
  lines.push(`- Clinical or scientific claims (clinically proven, studies show, dermatologist tested, N trials), statistics and percentages (other than a discount), certifications (organic, vegan, award-winning, certified) and objective superlatives (#1, best-selling, top-rated, <place>'s largest) may appear ONLY as an approved claim below, word for word. Anything else, write [DATA REQUIRED BEFORE LAUNCH: approved claim + citation, <claim>, ${name}] instead. ${cite(['spec.1.1', 'spec.1.9', 'spec.1.10'])}`);
  lines.push(`- Never promise a guaranteed result or outcome. ${cite(['spec.1.9'])}`);
  const ends = ctx.offer.ends_at ? `the offer ends ${ctx.offer.ends_at}` : 'no offer end date is on record';
  const stock = ctx.offer.stock != null ? `stock on record: ${ctx.offer.stock}` : 'no stock level is on record';
  lines.push(`- Deadline and scarcity lines (ends tonight, today only, only N left, selling fast) only when the offer data says so: ${ends}; ${stock}. ${cite(['spec.1.1'])}`);
  if (has(ctx, 'us.fda-ftc.health')) {
    const sup = ctx.sectors.includes('dietary_supplement');
    lines.push(`- Never say or imply the product diagnoses, treats, cures, mitigates or prevents a disease or its symptoms, even negated ("does not cure"). ${cite(sup ? ['cfr21.101.93g', 'usc21.343r6'] : ['usc21.321g1'])}`);
    lines.push(`- A health or weight-loss benefit (supports, promotes, boosts, helps maintain ...) needs competent and reliable scientific evidence: use only an approved claim that carries its citation. ${cite(['ftc.health'])}`);
    if (sup) lines.push(`- Every structure/function statement ends with * and the asset carries, word for word, beside it: *${DISCLAIMER_SINGULAR} (with two or more statements: *${DISCLAIMER_PLURAL}) ${cite(['cfr21.101.93c', 'usc21.343r6'])}`);
  }
  if (has(ctx, 'us.ftc')) lines.push(`- A testimonial or creator mention discloses any paid, gifted or business connection clearly beside it. ${cite(['cfr16.255.5'])}`);
  if (has(ctx, 'uk.cap15')) {
    lines.push(`- UK: never claim a food or supplement prevents, treats or cures a disease. ${cite(['cap.15.6.2', 'reg1169.7.3'])}`);
    lines.push(`- UK: health claims only in GB NHC Register wording recorded as approved below; never the rate or amount of weight loss. ${cite(['cap.15.1.1', 'cap.15.6.6'])}`);
  }
  if (has(ctx, 'uk.cap12')) lines.push(`- UK: no medicinal claim for an unlicensed product; objective health claims need evidence held before publication. ${cite(['cap.12.11', 'cap.12.1'])}`);
  if (has(ctx, 'uk.cap')) lines.push(`- UK: content by a paid or gifted creator is labelled up front as an ad. ${cite(['cap.2'])}`);
  // A guaranteed outcome is prohibited even when it sits on the approved
  // list, so the writer is never handed one as usable.
  const usable = ctx.approved.filter((c) => c.inRegion && !allMatches(RX_GUARANTEED_OUTCOME, c.text).length);
  if (usable.length) {
    lines.push('APPROVED CLAIMS (word for word, or not at all):');
    for (const c of usable) {
      lines.push(`  - "${c.text}"${c.citation ? ` [citation: ${c.citation.source}${c.citation.url ? ` ${c.citation.url}` : ''}]` : ' [approved on the brand record; no evidence citation, so never present it as clinical or scientific]'}${c.register ? ` [${c.register}]` : ''}`);
    }
  } else {
    lines.push(`APPROVED CLAIMS: none on ${name}'s record for ${ctx.market || 'this market'}. Write no statistic, clinical, scientific, certification or superlative claim.`);
  }
  return lines.join('\n');
}

module.exports = {
  lint,
  lintPayload: lint,
  brief,
  contextFor,
  extractText,
  fieldsOf,
  approvedClaims,
  SOURCES,
  PACKS,
  SECTORS,
  DISCLAIMER_SINGULAR,
  DISCLAIMER_PLURAL,
};
