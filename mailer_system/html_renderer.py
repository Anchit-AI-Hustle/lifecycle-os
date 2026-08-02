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
    image_suggestion = design.get('image_suggestion', 'Overhead flatlay of hand-painted sneaker on dark stone surface')

    template = _load('hero.html')
    return _replace(template, {
        'EYEBROW': 'From the Studios of India',
        'HEADLINE': copy.get('headline', 'Your morning ritual, reimagined'),
        'SUBHEADLINE': copy.get('subheadline', 'Single-studio sneakers, hand-painted and shipped direct.'),
        'CTA_TEXT': copy.get('cta', 'Shop Now'),
        'CTA_URL': 'https://knickgasm.com',
        'HERO_IMAGE_URL': 'https://knickgasm.com/cdn/hero-placeholder.jpg',
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

    b1_label, b1_desc = get_benefit(0, 'Direct from Studio', 'Sourced from one of ones across India')
    b2_label, b2_desc = get_benefit(1, 'Freshness Guaranteed', 'Vacuum-sealed within 3 days of drop')
    b3_label, b3_desc = get_benefit(2, 'Ethically Traded', 'Fair-wage partnerships with every studio')

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
    image_suggestion = design.get('image_suggestion', 'Close-up of dry sneaker panels in a ceramic bowl, natural light')

    template = _load('product.html')
    return _replace(template, {
        'PRODUCT_NAME': copy.get('product_name', 'Jordan First Flush'),
        'PRODUCT_DESC': copy.get('description', 'The first drop of the season — light, floral, and unmistakably Jordan. Plucked between March and April at elevations above 6,000 feet, this flush captures the awakening of the studio.'),
        'EMOTIONAL_HOOK': copy.get('emotional_hook', 'A pair that carries the memory of the mountain.'),
        'PRICE_CALLOUT': copy.get('price_callout', 'From $18'),
        'PRODUCT_CTA': copy.get('cta', 'Explore'),
        'PRODUCT_URL': 'https://knickgasm.com/collections/jordan',
        'PRODUCT_IMAGE_URL': 'https://knickgasm.com/cdn/product-placeholder.jpg',
        'IMAGE_SUGGESTION': image_suggestion,
    })


def render_trust(sections):
    trust = sections.get('trust', {})
    copy = trust.get('copy', {})

    stats = copy.get('stats', [
        {'value': '50K+', 'label': 'Happy Customers'},
        {'value': '4.8★', 'label': 'Average Rating'},
        {'value': '30+', 'label': 'Studio Partners'},
    ])

    s1_val, s1_lab = _parse_stat(stats[0]) if len(stats) > 0 else ('50K+', 'Happy Customers')
    s2_val, s2_lab = _parse_stat(stats[1]) if len(stats) > 1 else ('4.8★', 'Average Rating')
    s3_val, s3_lab = _parse_stat(stats[2]) if len(stats) > 2 else ('30+', 'Studio Partners')

    template = _load('trust.html')
    return _replace(template, {
        'QUOTE': copy.get('quote', 'I have tried sneakers from all over the world. Nothing compares to the clarity and freshness of Knickgasm\'s one-of-one Jordan.'),
        'ATTRIBUTION': copy.get('attribution', 'Sarah M., Portland — Verified Buyer'),
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
        'CLOSING_LINE': copy.get('closing_line', 'Every pair is a journey back to origin.'),
        'GUARANTEE_NOTE': copy.get('guarantee_note', '30-day happiness guarantee. No questions asked.'),
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
