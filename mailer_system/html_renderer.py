import json
import os
from datetime import datetime

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'templates')
OUTPUTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outputs')


def _load(filename):
    path = os.path.join(TEMPLATES_DIR, filename)
    with open(path, encoding='utf-8') as f:
        return f.read()


def _replace(template, mapping):
    for key, value in mapping.items():
        template = template.replace('{{' + key + '}}', str(value) if value is not None else '')
    return template


# Placeholder for any slot the model did not fill.
#
# Nothing in this file may assert a product fact, a price, a rating, a customer
# count or a testimonial. The defaults here used to do all four, and because
# this engine was copied from a sibling repo built for a different company they
# described that company's business - a single-estate tea, plucked at altitude,
# vacuum-sealed after harvest, at $18 - with the brand name swapped. A default
# is exactly where a fabricated fact hides, because it only renders when the
# model went quiet, which is when nobody is looking.
#
# So an unfilled slot now renders the marker. A mailer with a visible gap gets
# fixed; a mailer with a plausible invented product gets sent.
def _missing(what):
    return f"[DATA REQUIRED BEFORE LAUNCH: {what}]"


def _parse_stat(stat_raw):
    if isinstance(stat_raw, dict):
        return stat_raw.get('value', ''), stat_raw.get('label', '')
    if isinstance(stat_raw, str) and ':' in stat_raw:
        parts = stat_raw.split(':', 1)
        return parts[0].strip(), parts[1].strip()
    return str(stat_raw), ''


def render_hero(sections):
    hero = sections.get('hero', {})
    copy = hero.get('copy', {})
    design = hero.get('design_guidance', {})
    image_suggestion = design.get('image_suggestion', 'Overhead flatlay of a hand-painted pair on a plain surface')

    template = _load('hero.html')
    return _replace(template, {
        # Approved claim (data/brands/_default.json). Safe as a constant.
        'EYEBROW': 'Hand-painted in Mumbai',
        'HEADLINE': copy.get('headline') or _missing('hero headline'),
        'SUBHEADLINE': copy.get('subheadline') or _missing('hero subheadline'),
        'CTA_TEXT': copy.get('cta', 'Shop Now'),
        'CTA_URL': 'https://knickgasm.com',
        # No invented CDN path. An empty src renders a broken image, which is a
        # visible instruction to drop a real verified asset in.
        'HERO_IMAGE_URL': '',
        'IMAGE_SUGGESTION': image_suggestion,
    })


def render_value(sections):
    value = sections.get('value', {})
    copy = value.get('copy', {})
    benefits = copy.get('benefits', [])

    def get_benefit(idx, default_label, default_desc):
        if idx < len(benefits):
            b = benefits[idx]
            return b.get('label', default_label), b.get('description', default_desc)
        return default_label, default_desc

    # Fallbacks are the brand's approved verifiable claims and nothing else
    # (data/brands/_default.json -> claims). No freshness, sourcing or trade
    # claim is made: none has been approved for this brand.
    b1_label, b1_desc = get_benefit(0, 'One of one', 'Hand-painted by India\'s best artists, never repeated')
    b2_label, b2_desc = get_benefit(1, 'Original bases', 'Made on 100% original brand sneakers')
    b3_label, b3_desc = get_benefit(2, 'Built to wear', 'Water and scratch resistant designs')

    template = _load('value.html')
    return _replace(template, {
        'BENEFIT_1_LABEL': b1_label,
        'BENEFIT_1_DESC': b1_desc,
        'BENEFIT_2_LABEL': b2_label,
        'BENEFIT_2_DESC': b2_desc,
        'BENEFIT_3_LABEL': b3_label,
        'BENEFIT_3_DESC': b3_desc,
    })


def render_product(sections):
    product = sections.get('product', {})
    copy = product.get('copy', {})
    design = product.get('design_guidance', {})
    image_suggestion = design.get('image_suggestion', 'Close-up of the hand-painted linework on the panel, natural light')

    template = _load('product.html')
    return _replace(template, {
        'PRODUCT_NAME': copy.get('product_name') or _missing('product name, from the live catalog'),
        'PRODUCT_DESC': copy.get('description') or _missing('product description, from the live catalog'),
        'EMOTIONAL_HOOK': copy.get('emotional_hook') or _missing('product hook line'),
        'PRICE_CALLOUT': copy.get('price_callout') or _missing('price and currency, per region'),
        'PRODUCT_CTA': copy.get('cta', 'Explore'),
        # A product URL must point at the actual PDP for the product above, so it
        # cannot be defaulted. The all-products collection is the only link that
        # is true regardless of which product the model chose.
        'PRODUCT_URL': 'https://knickgasm.com/collections/all',
        'PRODUCT_IMAGE_URL': '',
        'IMAGE_SUGGESTION': image_suggestion,
    })


def render_trust(sections):
    trust = sections.get('trust', {})
    copy = trust.get('copy', {})

    # Customer counts, star averages and partner counts are approved-data
    # figures. There is no approved review library in this repo yet, so there is
    # no honest default: an unfilled stat renders the marker.
    fallback_stats = [
        {'value': '', 'label': _missing('customer count, approved figure')},
        {'value': '', 'label': _missing('average rating and review count, approved figure')},
        {'value': '', 'label': _missing('third trust stat, approved figure')},
    ]
    stats = copy.get('stats') or fallback_stats

    def stat_at(idx):
        if idx < len(stats):
            return _parse_stat(stats[idx])
        return _parse_stat(fallback_stats[idx])

    s1_val, s1_lab = stat_at(0)
    s2_val, s2_lab = stat_at(1)
    s3_val, s3_lab = stat_at(2)

    template = _load('trust.html')
    return _replace(template, {
        'QUOTE': copy.get('quote') or _missing('approved customer quote, per product and region'),
        'ATTRIBUTION': copy.get('attribution') or _missing('reviewer attribution, approved review library'),
        'STAT_1_VALUE': s1_val,
        'STAT_1_LABEL': s1_lab,
        'STAT_2_VALUE': s2_val,
        'STAT_2_LABEL': s2_lab,
        'STAT_3_VALUE': s3_val,
        'STAT_3_LABEL': s3_lab,
    })


def render_footer(sections):
    footer = sections.get('footer', {})
    copy = footer.get('copy', {})

    template = _load('footer.html')
    return _replace(template, {
        'CLOSING_LINE': copy.get('closing_line', 'One pair, painted once, for one person.'),
        # A returns/guarantee policy is a legal commitment, not copy. Never
        # default one in.
        'GUARANTEE_NOTE': copy.get('guarantee_note') or _missing('returns and guarantee policy, per region'),
        'FOOTER_CTA': copy.get('cta', 'Shop Knickgasm'),
        'FOOTER_CTA_URL': 'https://knickgasm.com',
    })


def render(api_result, brief, campaign_type):
    os.makedirs(OUTPUTS_DIR, exist_ok=True)

    response = api_result.get('response', {})
    sections = response.get('sections', {})
    subject_lines = response.get('subject_lines', [])
    preheader = response.get('preheader', '')
    cta_options = response.get('cta_options', [])
    performance_notes = response.get('performance_notes', {})

    # Build each section
    hero_html = render_hero(sections)
    value_html = render_value(sections)
    product_html = render_product(sections)
    trust_html = render_trust(sections)
    footer_html = render_footer(sections)

    # Assemble into base template
    base = _load('base_email.html')
    email_html = _replace(base, {
        'PREHEADER': preheader,
        'HERO_SECTION': hero_html,
        'VALUE_SECTION': value_html,
        'PRODUCT_SECTION': product_html,
        'TRUST_SECTION': trust_html,
        'FOOTER_SECTION': footer_html,
        'UNSUBSCRIBE_URL': 'https://knickgasm.com/unsubscribe',
        'PRIVACY_URL': 'https://knickgasm.com/privacy',
    })

    # Save HTML output
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    html_filename = f"{campaign_type}_{timestamp}.html"
    meta_filename = f"{campaign_type}_{timestamp}_meta.json"
    html_path = os.path.join(OUTPUTS_DIR, html_filename)
    meta_path = os.path.join(OUTPUTS_DIR, meta_filename)

    with open(html_path, 'w', encoding='utf-8') as f:
        f.write(email_html)

    # Save metadata
    meta = {
        'campaign_type': campaign_type,
        'trigger_reason': brief.get('goal', campaign_type),
        'brief': brief,
        'subject_lines': subject_lines,
        'preheader': preheader,
        'cta_options': cta_options,
        'performance_notes': performance_notes,
        'generated_at': api_result.get('generated_at', datetime.now().isoformat()),
        'tokens_used': api_result.get('tokens_used', {}),
        'file_path': html_path,
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=2)

    file_size_kb = round(os.path.getsize(html_path) / 1024, 1)
    print(f"[saved] {html_filename} ({file_size_kb}KB)")

    return html_path, meta_path
