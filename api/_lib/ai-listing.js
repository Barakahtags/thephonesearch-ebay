const { analyseVariant, customerSafe, samsungServiceCode } = require('./part-variants');

function clean(v) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function esc(v) { return customerSafe(v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
function cap80(v) { const s = customerSafe(v); return s.length <= 80 ? s : s.slice(0, 80).replace(/\s+\S*$/, '').trim(); }
function uniq(a) { return [...new Set(a.filter(Boolean).map(customerSafe).filter(Boolean))]; }
function regexEscape(v) { return String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function normalizeBrand(v) { return customerSafe(v).replace(/^(?:(?:for|für)\s+)+/i, '').trim(); }

const PART_RULES = [
  ['Akku', /\bbattery\b|\bakku\b/i], ['Display', /\bdisplay\b|\bscreen\b|\blcd\b|\boled\b|\btouchscreen\b/i],
  ['Ladebuchse', /charging|charge port|dock connector|usb[ -]?c|ladebuchse/i], ['Kamera', /\bcamera\b|kamera/i],
  ['Kameraglas', /camera (?:glass|lens)|kameraglas/i], ['Akkudeckel', /rear cover|back cover|back glass|battery cover|akkudeckel|rückseite/i],
  ['Gehäuse', /housing|gehäuse/i], ['Flexkabel', /flex cable|\bflex\b/i], ['Lautsprecher', /speaker|loudspeaker|earpiece|hörmuschel/i],
  ['Mikrofon', /microphone|\bmic\b|mikrofon/i], ['Antenne', /antenna|antenne/i], ['Klebestreifen', /adhesive\s*(?:str(?:ip)?s?)?|glue\s*strip|klebestreifen/i],
  ['Klebefolie', /adhesive|tape|kleber|klebefolie/i], ['Schutzglas', /tempered glass|screen protector|protective glass|schutzglas/i],
  ['Taste', /button|power key|volume key|taste/i], ['SIM Kartenleser', /sim reader|sim card reader|sim slot/i],
  ['Vibrator', /vibrator|vibration motor|taptic/i], ['Kopfhörerbuchse', /headphone|audio jack|klinke/i],
  ['Mainboard', /mainboard|motherboard|logic board/i], ['Rahmen', /middle frame|midframe|bezel|rahmen/i],
  ['Schraubendreher', /screwdriver|schraubendreher/i], ['Pinzette', /tweezer|pinzette/i],
  ['Lötzubehör', /solder|soldering|flux|löten|lötzubehör/i], ['Werkzeug', /tool|opening|spudger|repair kit|werkzeug|screws? storage tray|magnetic tray/i]
];
const PRECISE_PART_RULES = [
  ['Klebestreifen', /adhesive\s*(?:str(?:ip)?s?)?|glue\s*strip|klebestreifen/i], ['Kameraglas', /camera (?:glass|lens)|kameraglas/i],
  ['Schutzglas', /tempered glass|screen protector|protective glass|schutzglas/i], ['Akkudeckel', /rear cover|back cover|back glass|battery cover|akkudeckel|rückseite/i],
  ['Ladebuchse', /charging board|charging port|charge port|dock connector|ladebuchse/i]
];

function inferPartType(text) {
  const s = clean(text);
  for (const [name, re] of PRECISE_PART_RULES) if (re.test(s)) return name;
  for (const [name, re] of PART_RULES) if (re.test(s)) return name;
  return 'Ersatzteil';
}

const TITLE_KEYWORDS = {
  Akku: ['Akku', 'Batterie', 'Battery', 'Ersatzakku'], Display: ['Display', 'Screen', 'Touchscreen'],
  Ladebuchse: ['Ladebuchse', 'Charging Port', 'Charging Flex', 'Ladeflex'], Kamera: ['Kamera', 'Camera', 'Modul'],
  Kameraglas: ['Kameraglas', 'Camera Glass', 'Linse', 'Lens'], Akkudeckel: ['Akkudeckel', 'Rückseite', 'Backcover', 'Deckel'],
  Gehäuse: ['Gehäuse', 'Housing', 'Backcover'], Flexkabel: ['Flexkabel', 'Flex Cable'], Lautsprecher: ['Lautsprecher', 'Speaker', 'Buzzer'],
  Mikrofon: ['Mikrofon', 'Microphone', 'Mic'], Antenne: ['Antenne', 'Antenna', 'Signal Flex'],
  Klebestreifen: ['Klebestreifen', 'Adhesive Strip', 'Klebefolie', 'Montage'], Klebefolie: ['Klebefolie', 'Adhesive', 'Kleber', 'Montage'],
  Schutzglas: ['Schutzglas', 'Panzerglas', 'Screen Protector'], Taste: ['Taste', 'Button', 'Key Flex'],
  'SIM Kartenleser': ['SIM Kartenleser', 'SIM Reader', 'Slot'], Vibrator: ['Vibrator', 'Vibration Motor', 'Taptic'],
  Kopfhörerbuchse: ['Kopfhörerbuchse', 'Audio Jack', 'Klinke'], Mainboard: ['Mainboard', 'Motherboard', 'Logic Board'],
  Rahmen: ['Rahmen', 'Frame', 'Mittelrahmen'], Schraubendreher: ['Schraubendreher', 'Screwdriver', 'Repair Tool'],
  Pinzette: ['Pinzette', 'Tweezers', 'Reparatur Werkzeug'], Lötzubehör: ['Lötzubehör', 'Soldering', 'Repair Tool'],
  Werkzeug: ['Werkzeug', 'Repair Tool', 'Reparatur Tool'], Ersatzteil: ['Ersatzteil', 'Spare Part']
};

function keywordsFor(partType, facts) {
  const base = [...(TITLE_KEYWORDS[partType] || TITLE_KEYWORDS.Ersatzteil)];
  if (partType === 'Display') {
    if (/oled/i.test(`${facts.supplierTitle} ${facts.variant.quality.label}`)) base.splice(1, 0, 'OLED');
    else if (/lcd|in[\s-]*cell|budget/i.test(`${facts.supplierTitle} ${facts.variant.quality.label}`)) base.splice(1, 0, 'LCD');
  }
  return uniq(base);
}

function hasCompatibleEvidence(text) { return /\bcompatible\b|\bcompatibel\b|\bkompatibel\b|\breplacement\b|\bsuitable\s+for\b|\bpassend\s+für\b|\bmade\s+for\b/i.test(clean(text)); }
function hasSamsungServiceCode(text) { return samsungServiceCode(text); }

function extractColour(text) {
  const pairs = [['Schwarz', /\bblack\b|schwarz/i], ['Weiß', /\bwhite\b|weiß|weiss/i], ['Blau', /\bblue\b|blau/i], ['Grün', /\bgreen\b|grün/i], ['Rot', /\bred\b|rot/i], ['Gold', /\bgold\b/i], ['Silber', /\bsilver\b|silber/i], ['Violett', /purple|violet|violett/i], ['Grau', /\bgray\b|\bgrey\b|grau/i]];
  for (const [name, re] of pairs) if (re.test(clean(text))) return name;
  return '';
}

function knownModel(title, brand) {
  const t = clean(title), b = clean(brand).toLowerCase();
  const patterns = [];
  if (b === 'apple' || /\b(?:iphone|ipad|macbook|watch)\b/i.test(t)) patterns.push(
    /\b(iPhone\s+(?:SE\s*(?:\([^)]*\)|\d{4})|(?:\d{1,2})(?:e|\s+mini|\s+Plus|\s+Pro(?:\s+Max)?)?|Air))\b/i,
    /\b(iPad\s+(?:Pro|Air|mini)?\s*[A-Za-z0-9.]+(?:\s+[A-Za-z0-9.]+){0,4})/i,
    /\b(MacBook\s+(?:Air|Pro|Neo)\s+[A-Za-z0-9()./ -]+)/i,
    /\b(Watch\s+(?:SE|Ultra|Series)[A-Za-z0-9. ()-]*)/i
  );
  if (b === 'samsung' || /\bgalaxy\b/i.test(t)) patterns.push(/\b(Galaxy\s+(?:(?:S|A|M|J)\d+[A-Za-z]?(?:\s+(?:FE|Edge|Plus|Ultra|5G|4G))?|Z\s+(?:Flip|Fold)\s*\d*(?:\s+(?:FE|5G))?|Note\s*\d+(?:\s+(?:Plus|Ultra|5G)){0,2}|XCover\s*\d*(?:\s+Pro)?|Tab\s+[A-Za-z0-9.]+(?:\s+[A-Za-z0-9."()-]+){0,3}|Book[A-Za-z0-9 ]+|Watch\s+Active))\b/i);
  if (b === 'google' || /\bpixel\b/i.test(t)) patterns.push(/\b(Pixel\s+\d+[A-Za-z]?(?:\s+(?:Pro(?:\s+(?:Fold|XL))?|Fold|XL|5G))?)\b/i);
  if (b === 'motorola' || /\b(?:moto|edge|razr)\b/i.test(t)) patterns.push(/\b(Moto\s+[A-Z]?\d+[A-Za-z]?(?:\s+(?:Plus|Play|Power|Lite|5G)){0,2}|Edge(?:\s+\d+)?(?:\s+(?:Plus|Fusion|Lite|Pro|Neo|Ultra))?|Razr\s*\d*(?:\s+(?:Ultra|5G))?(?:\s*\(\d{4}\))?|ThinkPhone|Defy\s*\(\d{4}\)|One\s+(?:Action|Hyper))\b/i);
  if (b === 'oneplus' || /\boneplus\b/i.test(t)) patterns.push(/\b(OnePlus\s+(?:\d+[A-Z]?(?:\s+(?:Pro|R|T|5G)){0,2}|Nord(?:\s+(?:CE|N)?\s*\d*[A-Za-z]?(?:\s+(?:Lite|5G))?){0,3}))\b/i);
  if (b === 'sony' || /\bxperia\b/i.test(t)) patterns.push(/\b(Xperia\s+(?:1|5|10)\s+(?:II|III|IV|V|VI|VII)|Xperia\s+(?:XZ2|XZ3|Pro-I))\b/i);
  if (b === 'xiaomi' || /\b(?:redmi|poco|xiaomi|mi)\b/i.test(t)) patterns.push(/\b((?:Redmi\s+(?:Note\s+)?|Poco\s+|Xiaomi\s+|Mi\s+)[A-Za-z0-9+]+(?:\s+(?:Pro\+?|Plus|Ultra|Lite|NFC|5G|4G|SE|NE|T|S|X)){0,3}(?:\s*\(\d{4}\))?)\b/i);
  if (b === 'oppo' || /\boppo\b/i.test(t)) patterns.push(/\b(Oppo\s+(?:Reno\s+\d+|A\d+[A-Za-z]?|Find\s+X\d+)(?:\s+(?:Pro|Lite|Neo|F|Z|S|4G|5G|N)){0,3}(?:\s*\(\d{4}\))?)\b/i);
  if (b === 'realme' || /\brealme\b/i.test(t)) patterns.push(/\b(Realme\s+(?:GT(?:\s+Neo)?|Narzo|Note|C|X)?\s*[A-Za-z0-9]+(?:\s+(?:Pro|Plus|Prime|Master|5G|150W|T|i|x)){0,3})\b/i);
  if (b === 'huawei' || /\b(?:huawei|mate|nova|p smart|enjoy)\b/i.test(t)) patterns.push(/\b((?:Huawei\s+)?(?:P\d+|Mate\s+\d+|P\s+Smart|Nova\s+[A-Za-z0-9]+|Enjoy\s+\d+)(?:\s+(?:Pro|Lite|Plus|New Edition|5G|E|Z)){0,3}(?:\s*\(\d{4}\))?)\b/i);
  if (b === 'honor' || /\bhonor\b/i.test(t)) patterns.push(/\b(Honor\s+(?:Magic\s*\d+|X?\d+[A-Za-z]?)(?:\s+(?:Pro|Lite|Smart|5G|V\d+)){0,2})\b/i);
  if (b === 'nokia' || /\bnokia\b/i.test(t)) patterns.push(/\b(Nokia\s+\d+(?:\.\d+)?)\b/i);
  for (const pattern of patterns) {
    const match = t.match(pattern); if (match) return customerSafe(match[1]);
  }
  return '';
}

function modelFromTitle(title, brand, partType) {
  const exact = knownModel(title, brand);
  if (exact) return exact;
  let s = customerSafe(title).replace(/\([^)]*\)/g, ' ');
  for (const [, re] of PRECISE_PART_RULES) s = s.replace(re, ' ');
  for (const [, re] of PART_RULES) s = s.replace(re, ' ');
  s = s.replace(/\bbattery\b|\bscreen\b|\bdisplay\b|\blcd\b|\boled\b|\btouchscreen\b|\bcharging board\b|\bcharge board\b|\bflex cable\b|\bspeaker\b|\bmicrophone\b|\bantenna\b|\badhesive\b|\bsim reader\b|\bvibration motor\b|\baudio jack\b|\blogic board\b|\bhousing\b|\bcamera\b/ig, ' ');
  if (partType === 'Ladebuchse') s = s.replace(/\bboard\b|\bport\b|\bdock\b/ig, ' ');
  s = s.replace(/\bcompatible\b|\bcompatibel\b|\bkompatibel\b|\breplacement\b|\bsuitable\s+for\b|\bpassend\s+für\b|\bmade\s+for\b/ig, ' ')
    .replace(/\boriginal\b|\bgenuine\b|\boem\b|factory\s*standard|best\s*possible|service\s*pack|\bpulled\b|\brefurbished\b|\brefurb\b|in[\s-]*cell|compatible\s*(?:soft|hard|budget)|soft[\s-]*oled|hard[\s-]*oled|high[\s-]*capacity|calibrated\s+used|with\s+sensor\s+flex|with\s+logo|without\s+logo|with\s+frame|incl\.?\s*frame|including\s+frame|without\s+frame|excl\.?\s*frame|\bfor\b|\bblack\b|\bwhite\b|\bblue\b|\bgreen\b|\bred\b|\bgold\b|\bsilver\b|\bgray\b|\bgrey\b|\bpurple\b|\bforest\b|\bschwarz\b|\bweiß\b|\bweiss\b|\bblau\b|\bgrün\b|\brot\b|\bsilber\b|\bviolett\b|\bgrau\b/ig, ' ')
    .replace(/[,:;|/]+/g, ' ').replace(/\s+-\s+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(for|für)\s+/i, '');
  if (brand) s = s.replace(new RegExp(`^(?:${regexEscape(brand)}\\s*)+`, 'i'), '').trim();
  return customerSafe(s);
}

function titleOptions(variant) {
  const out = [];
  if (variant.battery?.title) out.push(variant.battery.title);
  if (variant.options.frame === 'preassembled' || variant.options.frame === 'with') out.push('mit Rahmen');
  if (variant.options.frame === 'without') out.push('ohne Rahmen');
  if (variant.options.adhesive === 'with') out.push('mit Kleber');
  if (variant.options.ic === 'without') out.push('ohne IC');
  if (variant.quality.grade) out.push(`Grade ${variant.quality.grade}`);
  if (variant.display?.version) out.push(variant.display.version);
  return out;
}

function chooseTitle(facts) {
  const { brand, model, partType, colour, partNumber, isCompatible, variant } = facts, lead = [];
  if (isCompatible) lead.push('Für'); else if (['original', 'pulled', 'refurbished'].includes(variant.quality.code)) lead.push('Original');
  // Some supplier manufacturers are stored as "For Huawei" and some parsed
  // models already include their brand (for example "Xiaomi Mi 11 Ultra").
  // Never expose that supplier prefix or repeat the brand in an eBay title.
  if (brand && model && new RegExp(`^${regexEscape(brand)}\\b`, 'i').test(model)) lead.push(model);
  else lead.push(brand, model);
  let title = uniq(lead).join(' ');
  const qualityTerm = variant.quality.code === 'original' ? '' : (variant.quality.code === 'pulled' ? 'Pulled' : variant.quality.code === 'refurbished' ? 'Refurbished' : variant.quality.title);
  for (const word of uniq([...keywordsFor(partType, facts), qualityTerm, ...titleOptions(variant), colour, partNumber])) {
    const next = clean(`${title} ${word}`); if (next.length <= 80) title = next;
  }
  return cap80(title || facts.supplierTitle || partNumber || 'Ersatzteil');
}

function confidence(f) {
  let n = 0; const max = 7;
  if (f.brand) n++; if (f.model) n++; if (f.partType !== 'Ersatzteil') n++; if (f.partNumber) n++; if (f.ean) n++; if (f.supplierTitle.length > 8) n++; if (f.variant.quality.code !== 'unspecified') n++;
  return Math.round(n / max * 100);
}

const S = {
  shell: 'margin:0;padding:24px;background:#06142d;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;line-height:1.5;overflow-x:hidden;', wrap: 'width:100%;max-width:980px;margin:0 auto;',
  hero: 'padding:54px 34px;text-align:center;background:linear-gradient(135deg,#071a39,#0b2854);border:1px solid #c89b2c;border-radius:28px;', eyebrow: 'margin:0 0 12px;color:#e0b64e;font-size:13px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;',
  title: 'max-width:820px;margin:0 auto 16px;font-size:38px;line-height:1.12;letter-spacing:-.025em;color:#ffffff;', lead: 'max-width:720px;margin:0 auto;color:#d8e2f1;font-size:18px;',
  pill: 'display:inline-block;margin:18px 5px 0;padding:8px 14px;border-radius:999px;background:#102f5e;color:#f7d77b;border:1px solid #406796;font-size:13px;font-weight:700;', card: 'margin-top:18px;padding:28px 30px;background:#ffffff;border:1px solid #e5e5e7;border-radius:24px;',
  h2: 'margin:0 0 14px;font-size:22px;letter-spacing:-.01em;color:#0a2042;', body: 'margin:0;color:#334155;font-size:15px;', table: 'width:100%;border-collapse:collapse;font-size:14px;',
  th: 'width:38%;padding:12px 0;text-align:left;vertical-align:top;color:#64748b;border-bottom:1px solid #e5e7eb;font-weight:600;', td: 'padding:12px 0;text-align:left;vertical-align:top;color:#0f2749;border-bottom:1px solid #e5e7eb;font-weight:600;',
  note: 'margin-top:18px;padding:18px 20px;border-radius:16px;background:#f3f7fc;color:#334155;font-size:13px;', fine: 'margin-top:18px;padding:15px 18px;border-top:1px solid #d2d2d7;color:#64748b;font-size:10px;line-height:1.45;', footer: 'padding:26px 10px 8px;text-align:center;color:#d8e2f1;font-size:12px;'
};

function imageUrls(part) {
  const values = [...(Array.isArray(part?.Images) ? part.Images.map(x => x?.ImageUrl || x?.Url) : []), ...(Array.isArray(part?.imageUrls) ? part.imageUrls : [])];
  return [...new Set(values.map(clean).filter(x => /^https:\/\/[^\s"'<>]+$/i.test(x)))].slice(0, 4);
}

function imageGallery(f, title) {
  if (!f.images.length) return '';
  const cells = f.images.map((url, index) => `<td class="tps-gallery-cell" style="width:${100 / f.images.length}%;padding:8px;text-align:center;vertical-align:middle;background:#ffffff;"><img src="${url.replace(/&/g, '&amp;')}" alt="${esc(`${title} Produktbild ${index + 1}`)}" style="display:block;width:100%;max-width:320px;height:auto;margin:0 auto;border:0;border-radius:18px;object-fit:contain;"></td>`).join('');
  return `<section class="tps-card" style="${S.card}padding:16px;"><table class="tps-gallery" role="presentation" style="width:100%;border-collapse:separate;border-spacing:6px;table-layout:fixed;"><tbody><tr>${cells}</tr></tbody></table></section>`;
}

function recommendationImage(item) {
  const direct = clean(item?.imageUrl || item?.ImageUrl || item?.image);
  if (/^https:\/\/[^\s"'<>]+$/i.test(direct)) return direct;
  return imageUrls(item)[0] || '';
}

function recommendationLink(item) {
  const direct = clean(item?.ebayUrl || item?.listingUrl);
  if (/^https:\/\/(?:www\.)?ebay\.[a-z.]+\//i.test(direct)) return direct;
  const seller = clean(item?.sellerUsername || process.env.EBAY_SELLER_USERNAME || '');
  if (!seller) return '';
  const query = clean(item?.sku || item?.PartNumber || item?.title || item?.Description);
  return `https://www.ebay.de/sch/i.html?_ssn=${encodeURIComponent(seller)}&_nkw=${encodeURIComponent(query)}`;
}

function relatedProducts(f) {
  const products = (Array.isArray(f.recommendations) ? f.recommendations : []).filter(Boolean).slice(0, 4);
  if (!products.length) return '';
  const cards = products.map((item, index) => {
    const itemTitle = customerSafe(item.title || item.Description || item.supplierTitle || item.sku || item.PartNumber || 'Passendes Ersatzteil');
    const sku = customerSafe(item.sku || item.PartNumber || '');
    const image = recommendationImage(item), link = recommendationLink(item), tag = index === 0 ? 'Besonders empfohlen' : 'Passend zum Gerät';
    const imageHtml = image ? `<img src="${image.replace(/&/g, '&amp;')}" alt="${esc(itemTitle)}" style="display:block;width:100%;height:150px;object-fit:contain;border:0;border-radius:16px;background:#ffffff;">` : `<div style="height:150px;border-radius:16px;background:#f5f5f7;text-align:center;line-height:150px;color:#86868b;font-size:12px;">Produktbild</div>`;
    const content = `<div class="tps-related-card" style="display:inline-block;width:calc(25% - 12px);min-width:0;margin:6px;padding:14px;vertical-align:top;border:1px solid #e5e5e7;border-radius:20px;background:#ffffff;overflow:hidden;"><div>${imageHtml}</div><p style="margin:12px 0 5px;color:#0071e3;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;">${esc(tag)}</p><p style="min-height:44px;margin:0;color:#1d1d1f;font-size:14px;font-weight:700;line-height:1.35;overflow-wrap:anywhere;word-break:break-word;">${esc(itemTitle)}</p>${sku ? `<p style="margin:8px 0 0;color:#6e6e73;font-size:11px;overflow-wrap:anywhere;">SKU ${esc(sku)}</p>` : ''}${link ? '<p style="margin:12px 0 0;color:#0071e3;font-size:12px;font-weight:700;">Im Shop ansehen&nbsp;›</p>' : ''}</div>`;
    return link ? `<a href="${link.replace(/&/g, '&amp;')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;">${content}</a>` : content;
  }).join('');
  return `<section class="tps-card" style="${S.card}"><p style="${S.eyebrow}">Separat erhältlich</p><h2 style="${S.h2}">Passend für diese Reparatur</h2><p style="${S.body}margin-bottom:14px;">Modellbezogen ausgewählte Ergänzungen – zum Beispiel die passende Klebefolie für Display oder Rückseite. Bitte die SKU vor dem Kauf noch einmal vergleichen.</p><div class="tps-related-grid" style="margin:0 -6px;">${cards}</div></section>`;
}

function detailRows(f) {
  const rows = [], push = (label, value) => { if (value) rows.push(`<tr><th style="${S.th}">${esc(label)}</th><td style="${S.td}">${esc(value)}</td></tr>`); };
  push('Artikel', `${f.partType} · ${keywordsFor(f.partType, f).join(' · ')}`); push(f.isCompatible ? 'Passend für Marke' : 'Marke / Hersteller', f.brand);
  push(f.isCompatible ? 'Kompatibilität' : 'Modell / Zuordnung', f.model); push('Qualität', f.variant.quality.label); push('Ausführung', f.variant.battery?.label);
  push('Farbe', f.colour); push('Herstellernummer / SKU', f.partNumber); push('EAN', f.ean); push('Zustand', f.variant.quality.condition);
  return rows.join('');
}

function complianceNote(f) {
  if (f.partType === 'Akku') {
    const scope = f.variant.complianceCovered ? 'Die angegebene SKU ist einer in der Erklärung erfassten Batterieserie zugeordnet.' : 'Die Angabe gilt ausschließlich, wenn die SKU im zugehörigen Anhang aufgeführt ist.';
    return `<div style="${S.fine}"><strong>EU-Konformität (Batterie):</strong> Für die im Anhang der EU-Konformitätserklärung aufgeführten kompatiblen Batterie-SKUs wurde die Übereinstimmung mit Richtlinie 2011/65/EU (RoHS, einschließlich EU 2015/863) und Richtlinie 2014/30/EU (EMV) auf Grundlage technischer Unterlagen und Prüfberichte erklärt. ${esc(scope)} Stand: 08.07.2026.</div>`;
  }
  if (f.partType === 'Display') {
    const scope = f.variant.displayComplianceCovered ? 'Die angegebene SKU ist einer in der Erklärung erfassten Displayserie zugeordnet.' : 'Die Angabe gilt ausschließlich, wenn die SKU im zugehörigen Anhang aufgeführt ist.';
    return `<div style="${S.fine}"><strong>EU-Konformität (Display):</strong> Für die im Anhang der EU-Konformitätserklärung aufgeführten kompatiblen LCD-/OLED-Displayeinheiten wurde die Übereinstimmung mit Richtlinie 2011/65/EU (RoHS, einschließlich EU 2015/863) sowie – soweit anwendbar – Verordnung EU 2023/988 (GPSR) erklärt. Die Stoffprüfung orientiert sich an der IEC-62321-Reihe. ${esc(scope)} Stand: 08.07.2026.</div>`;
  }
  return '';
}

function sustainabilityCard(f) {
  if (!['pulled', 'refurbished'].includes(f.variant.quality.code)) return '';
  return `<section style="${S.card}"><h2 style="${S.h2}">Ressourcen bewusst nutzen</h2><p style="${S.body}">Die Wiederverwendung eines geprüften Originalteils oder Originalpanels verlängert den Lebenszyklus vorhandener Komponenten und reduziert den Bedarf an neu produzierten Ersatzteilen. Das unterstützt reparaturfreundliche, materialschonende Geräteinstandsetzung.</p></section>`;
}

function publicListingImageUrl(value) {
  const configured = String(process.env.EBAY_IMAGE_PROXY_ORIGIN || 'https://ie-verified-phones-ebay-hook.vercel.app');
  const origin = configured.endsWith('/') ? configured.slice(0, -1) : configured;
  return origin + '/api/sync-preview?action=ebay-image&src=' + encodeURIComponent(String(value || ''));
}

function displayQualityFacts(quality) {
  const facts = {
    original: ['Hersteller-Originalteil', 'Neuware', 'LCD/OLED: Erstausrüsterqualität', 'Helligkeit und Farbdarstellung entsprechend der Originalausführung'],
    service_pack: ['Apple Service Pack', 'Original Apple Teil über alternativen Partnerkanal', 'Neuware', 'Nach Kalibrierung mögliche iOS-Teilemeldung: „Genuine“'],
    pulled: ['Aus Originalgerät entnommen', 'Gebrauchtes Originalteil', 'Nach Kalibrierung je nach Ausführung „Used“ oder „Unknown“ möglich', 'Bitte Artikelzustand und Qualitätsstufe beachten'],
    refurbished: ['Originales LCD-/OLED-Panel', 'Professionell aufgearbeitet', 'Neues Frontglas / je nach Ausführung neue Polarisations- oder Touch-Komponente', 'Nach Kalibrierung je nach Ausführung „Used“ oder „Unknown“ möglich'],
    in_cell: ['Hochwertiges kompatibles In-Cell LCD', 'Touchsensor in die LCD-Struktur integriert', 'Mit Hintergrundbeleuchtung · 600+ NIT', 'Kein Originalteil des Geräteherstellers'],
    compatible_soft: ['Kompatibles flexibles Soft-OLED', 'Ohne Hintergrundbeleuchtung · 800+ NIT', 'Hohe Auflösung, weniger bruchempfindlich als Hard-OLED', 'Kein Originalteil des Geräteherstellers'],
    compatible_hard: ['Kompatibles starres Hard-OLED', 'Ohne Hintergrundbeleuchtung · 700+ NIT', 'Hohe Auflösung; durch starres Panel empfindlicher', 'Kein Originalteil des Geräteherstellers'],
    compatible_budget: ['Kompatibles Budget-LCD', 'Mit Hintergrundbeleuchtung · ca. 350–600 NIT', 'Preisgünstige Alternative mit niedrigerer Auflösung/Farbdarstellung möglich', 'Kein Originalteil des Geräteherstellers']
  };
  return facts[quality?.code] || [];
}

function buildDescription(f, title) {
  const quality=f.variant.quality;
  const details=[...f.variant.details];
  if(f.variant.testBeforeAssembly)details.push('Display vor der Montage vollständig anschließen und Funktion, Touch, Bild und Helligkeit prüfen. Schutzfolien erst nach erfolgreichem Test entfernen.');
  const badges=uniq([f.partType,quality.label,f.variant.battery?.label,f.colour]).map(x=>'<span style="display:inline-block;margin:5px 4px 0 0;padding:7px 11px;border:1px solid #d6aa42;border-radius:999px;color:#9a6b00;font-size:12px;font-weight:700">'+esc(x)+'</span>').join('');
  const gallery=f.images.length?'<section style="padding:18px;background:#fff;border:1px solid #e3e7ee;border-top:0"><table class="mpde-gallery" role="presentation" style="width:100%;border-collapse:collapse;table-layout:fixed"><tr>'+f.images.slice(0,4).map((url,index)=>'<td style="padding:7px;text-align:center;vertical-align:middle"><img src="'+publicListingImageUrl(url).replace(/&/g,'&amp;')+'" alt="'+esc(title+' Produktbild '+(index+1))+'" style="display:block;width:100%;height:360px;object-fit:contain;margin:0 auto;border:0;background:#fff"></td>').join('')+'</tr></table></section>':'';
  const qualityFacts=displayQualityFacts(quality);
  const qualityCard=qualityFacts.length?'<section class="mpde-card" style="margin-top:16px;padding:24px 26px;background:#fff;border:1px solid #e3e7ee;border-radius:12px"><h2 style="margin:0 0 12px;color:#0a2448;font-size:21px">Ausführung auf einen Blick</h2><ul style="margin:0;padding-left:19px;color:#34445a;font-size:14px;line-height:1.65">'+qualityFacts.map(x=>'<li style="margin:5px 0">'+esc(x)+'</li>').join('')+'</ul></section>':'';
  const variantDetails=details.length?'<section style="margin-top:16px;padding:22px 24px;background:#fff;border:1px solid #e3e7ee;border-radius:12px"><h2 style="margin:0 0 12px;color:#0a2448;font-size:21px">Ausführung &amp; technische Hinweise</h2><ul style="margin:0;padding-left:19px;color:#34445a;font-size:14px;line-height:1.6">'+details.map(x=>'<li style="margin:6px 0">'+esc(x)+'</li>').join('')+'</ul></section>':'';
  const compatibility=f.isCompatible?'Kompatibles Ersatzteil: Bitte vergleichen Sie vor dem Kauf Modell, Teilenummer, Ausführung, Anschlüsse und Farbe. Die Gerätebezeichnung beschreibt ausschließlich die Kompatibilität.':'Bitte vergleichen Sie vor dem Kauf Modell, Teilenummer, Ausführung, Anschlüsse und Farbe mit dem vorhandenen Bauteil.';
  const intro=f.isCompatible?'Passendes '+f.partType+' für das angegebene Gerät.':'Originales bzw. spezifiziertes '+f.partType+' in der angegebenen Ausführung.';
  const responsive='<style>.mpde-root,.mpde-root *{box-sizing:border-box}.mpde-root{width:100%;max-width:100%;overflow:hidden}.mpde-root img{max-width:100%;height:auto}@media(max-width:620px){.mpde-root{padding:0!important}.mpde-hero{padding:24px 16px!important}.mpde-title{font-size:25px!important}.mpde-card{padding:18px 16px!important}.mpde-gallery,.mpde-gallery tbody,.mpde-gallery tr,.mpde-gallery td{display:block!important;width:100%!important}.mpde-gallery td{padding:5px 0!important}.mpde-gallery img{height:auto!important;max-height:280px!important}.mpde-spec,.mpde-spec tbody,.mpde-spec tr,.mpde-spec th,.mpde-spec td{display:block!important;width:100%!important}.mpde-spec th{padding-bottom:3px!important;border-bottom:0!important}.mpde-spec td{padding-top:0!important}}</style>';
  return customerSafe(responsive+
    '<div class="mpde-root" style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#16253a;line-height:1.5">'+
      '<div style="max-width:980px;margin:0 auto">'+
        '<header class="mpde-hero" style="padding:28px 32px;background:linear-gradient(125deg,#061832,#0c3266);border-bottom:4px solid #d7aa3d;text-align:left">'+
          '<div style="font-size:25px;font-weight:800;letter-spacing:-.5px;color:#fff">MobileParts<span style="color:#e0b64e">DE</span></div>'+
          '<div style="margin-top:3px;color:#dbe8f8;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Ersatzteile für Smartphone, Tablet &amp; Elektronik</div>'+
        '</header>'+
        '<section style="background:#fff;border:1px solid #e3e7ee;border-top:0;padding:28px 30px">'+
          '<div style="color:#a9790d;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Premium Ersatzteil</div>'+
          '<h1 class="mpde-title" style="margin:8px 0 10px;color:#09284f;font-size:31px;line-height:1.18;letter-spacing:-.4px">'+esc(title)+'</h1>'+
          '<p style="margin:0;color:#52657c;font-size:16px">'+esc(intro)+'</p><div style="margin-top:12px">'+badges+'</div>'+
        '</section>'+gallery+
        '<section style="display:table;width:100%;table-layout:fixed;background:#0b2850;color:#fff">'+
          '<div style="display:table-cell;padding:16px 12px;text-align:center;border-right:1px solid #365476"><b style="display:block;color:#e0b64e;font-size:13px">✓ Passgenau prüfen</b><span style="font-size:12px;color:#d8e5f4">Modell &amp; Teilenummer vergleichen</span></div>'+
          '<div style="display:table-cell;padding:16px 12px;text-align:center;border-right:1px solid #365476"><b style="display:block;color:#e0b64e;font-size:13px">✓ Sorgfältig verpackt</b><span style="font-size:12px;color:#d8e5f4">Für einen sicheren Versand</span></div>'+
          '<div style="display:table-cell;padding:16px 12px;text-align:center"><b style="display:block;color:#e0b64e;font-size:13px">✓ Klar beschrieben</b><span style="font-size:12px;color:#d8e5f4">Artikelzustand transparent erklärt</span></div>'+
        '</section>'+
        '<section class="mpde-card" style="margin-top:16px;padding:24px 26px;background:#fff;border:1px solid #e3e7ee;border-radius:12px">'+
          '<h2 style="margin:0 0 9px;color:#0a2448;font-size:21px">Qualität &amp; Zustand</h2><p style="margin:0;color:#34445a;font-size:14px">'+esc(quality.description)+'</p>'+
        '</section>'+qualityCard+variantDetails+
        '<section class="mpde-card" style="margin-top:16px;padding:24px 26px;background:#fff;border:1px solid #e3e7ee;border-radius:12px">'+
          '<h2 style="margin:0 0 12px;color:#0a2448;font-size:21px">Artikeldetails</h2>'+
          '<table class="mpde-spec" role="presentation" style="width:100%;border-collapse:collapse;font-size:14px"><tbody>'+detailRows(f)+'</tbody></table>'+
          '<div style="margin-top:16px;padding:15px 17px;background:#f3f7fc;border-left:4px solid #d7aa3d;color:#34445a;font-size:13px"><b>Lieferumfang:</b> 1x '+esc(f.partType)+' wie beschrieben.<br><b>Vor dem Kauf prüfen:</b> '+esc(compatibility)+'</div>'+complianceNote(f)+
        '</section>'+sustainabilityCard(f)+relatedProducts(f)+
        '<footer style="margin-top:18px;padding:28px 20px;background:#061832;text-align:center;color:#c7d8ec;font-size:12px"><b style="display:block;color:#e0b64e;font-size:18px;margin-bottom:5px">MobilePartsDE</b>Qualitätsteile für Reparatur, Ersatz und Werterhalt.<br><span style="color:#8fa8c4">Bitte bewahren Sie die Artikel- und Verpackungsdaten für Rückfragen auf.</span></footer>'+
      '</div>'+
    '</div>');
}
function buildDescription(f, title) {
  const quality=f.variant.quality;
  const details=[...(f.variant.details||[])];
  if(f.variant.testBeforeAssembly)details.push('Vor der endgültigen Montage bitte Funktion, Anschlüsse und Passform vollständig prüfen.');
  const compatibility=f.isCompatible
    ? 'Kompatibles Ersatzteil. Bitte Modell, Teilenummer, Ausführung, Anschlüsse und Farbe vor dem Kauf sorgfältig vergleichen.'
    : 'Bitte Modell, Teilenummer, Ausführung, Anschlüsse und Farbe vor dem Kauf sorgfältig vergleichen.';
  const rows=detailRows(f);
  const detailList=details.length?'<ul style="margin:0;padding-left:20px;color:#334155;font-size:14px;line-height:1.65;">'+details.map(x=>'<li style="margin:5px 0;">'+esc(x)+'</li>').join('')+'</ul>':'';
  const qualityFacts=displayQualityFacts(quality);
  const qualityList=qualityFacts.length?'<ul style="margin:8px 0 0;padding-left:20px;color:#334155;font-size:14px;line-height:1.65;">'+qualityFacts.map(x=>'<li style="margin:5px 0;">'+esc(x)+'</li>').join('')+'</ul>':'';
  // eBay-safe HTML only: no style blocks, scripts, galleries, or external card images.
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:900px;margin:0 auto;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#1f2937;background:#ffffff;">'+
    '<tr><td style="padding:24px 28px;background:#071d3b;border-bottom:4px solid #d7aa3d;">'+
      '<div style="font-size:26px;line-height:1.1;font-weight:700;color:#ffffff;">MobileParts<span style="color:#e0b64e;">DE</span></div>'+
      '<div style="margin-top:6px;font-size:12px;letter-spacing:1px;color:#dbe8f8;text-transform:uppercase;">Ersatzteile für Smartphone, Tablet &amp; Elektronik</div>'+
    '</td></tr>'+
    '<tr><td style="padding:26px 28px;border:1px solid #e2e8f0;border-top:0;">'+
      '<div style="font-size:12px;font-weight:700;letter-spacing:1px;color:#a9790d;text-transform:uppercase;">Artikelinformation</div>'+
      '<h1 style="margin:8px 0 10px;font-size:27px;line-height:1.25;color:#0a2448;">'+esc(title)+'</h1>'+
      '<p style="margin:0;font-size:15px;line-height:1.6;color:#475569;">'+esc(f.isCompatible?'Passendes Ersatzteil für das angegebene Gerät.':'Originales bzw. spezifiziertes Ersatzteil in der beschriebenen Ausführung.')+'</p>'+
    '</td></tr>'+
    '<tr><td style="padding:0;border:1px solid #e2e8f0;border-top:0;background:#0b2850;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#ffffff;"><tr>'+ 
      '<td width="33%" style="padding:18px 12px;text-align:center;border-right:1px solid #365476;"><strong style="display:block;color:#e0b64e;font-size:13px;">Qualität klar erklärt</strong><span style="font-size:12px;color:#dbe8f8;">Transparente Qualitätsstufe</span></td>'+ 
      '<td width="33%" style="padding:18px 12px;text-align:center;border-right:1px solid #365476;"><strong style="display:block;color:#e0b64e;font-size:13px;">Passform prüfen</strong><span style="font-size:12px;color:#dbe8f8;">Modell &amp; Teilenummer beachten</span></td>'+ 
      '<td width="33%" style="padding:18px 12px;text-align:center;"><strong style="display:block;color:#e0b64e;font-size:13px;">Reparatur im Fokus</strong><span style="font-size:12px;color:#dbe8f8;">Teile für Werterhalt &amp; Instandsetzung</span></td>'+ 
    '</tr></table></td></tr>'+
    '<tr><td style="padding:22px 28px;border:1px solid #e2e8f0;border-top:0;background:#f8fafc;">'+
      '<h2 style="margin:0 0 10px;font-size:20px;color:#0a2448;">Warum MobilePartsDE?</h2>'+ 
      '<p style="margin:0;font-size:14px;line-height:1.7;color:#334155;">Wir setzen auf eine klare, ehrliche Beschreibung von Ersatzteilen: Qualität, Ausführung, Kompatibilität und Zustand werden je Artikel transparent angegeben. So können Reparaturen gezielt geplant und Fehlkäufe vermieden werden.</p>'+ 
    '</td></tr>'+
    '<tr><td style="padding:22px 28px;border:1px solid #e2e8f0;border-top:0;">'+
      '<h2 style="margin:0 0 10px;font-size:20px;color:#0a2448;">Qualität &amp; Zustand</h2>'+
      '<p style="margin:0;font-size:14px;line-height:1.65;color:#334155;">'+esc(quality.description||quality.label||'Bitte Artikelbeschreibung beachten.')+'</p>'+qualityList+
    '</td></tr>'+
    (detailList?'<tr><td style="padding:22px 28px;border:1px solid #e2e8f0;border-top:0;"><h2 style="margin:0 0 10px;font-size:20px;color:#0a2448;">Ausführung &amp; Hinweise</h2>'+detailList+'</td></tr>':'')+
    '<tr><td style="padding:22px 28px;border:1px solid #e2e8f0;border-top:0;"><h2 style="margin:0 0 10px;font-size:20px;color:#0a2448;">Artikeldetails</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">'+rows+'</table>'+
      '<div style="margin-top:18px;padding:14px 16px;border-left:4px solid #d7aa3d;background:#f4f7fb;font-size:13px;line-height:1.65;color:#334155;"><strong>Lieferumfang:</strong> 1x '+esc(f.partType)+' wie beschrieben.<br><strong>Vor dem Kauf prüfen:</strong> '+esc(compatibility)+'</div>'+
    '</td></tr>'+
    '<tr><td style="padding:20px 28px;background:#071d3b;text-align:center;font-size:12px;line-height:1.55;color:#dbe8f8;"><strong style="font-size:16px;color:#e0b64e;">MobilePartsDE</strong><br>Qualitätsteile für Reparatur, Ersatz und Werterhalt.</td></tr>'+
  '</table>';
}

async function optimizeListing(p) {
  const supplierTitle = customerSafe(p.Description || p.PartNumber || 'Ersatzteil'), rawBrand = normalizeBrand(p.Manufacturer || ''), brand = /^other$/i.test(rawBrand) ? '' : rawBrand;
  const partType = inferPartType(supplierTitle), variant = analyseVariant(p, partType), colour = extractColour(supplierTitle), model = modelFromTitle(supplierTitle, brand, partType);
  const partNumber = customerSafe(p.PartNumber || p.Id || ''), ean = customerSafe(p.EanNumber || ''), isSamsungCode = hasSamsungServiceCode(`${partNumber} ${supplierTitle}`);
  const isCompatible = !!variant.quality.compatible || (variant.quality.code === 'unspecified' && hasCompatibleEvidence(variant.sourceText));
  const facts = { supplierTitle, brand, model, partType, colour, partNumber, ean, isCompatible, isSamsungCode, variant, images: imageUrls(p), recommendations: Array.isArray(p._recommendations) ? p._recommendations : [] };
  const title = chooseTitle(facts), description = buildDescription(facts, title);
  return { supplierTitle, title, description, source: 'local-variant-engine-v3', confidence: confidence(facts), paidAi: false, classification: { brand, model, partType, quality: variant.quality.label, qualityCode: variant.quality.code, colour, isCompatible, isSamsungCode, options: variant.options, display: variant.display, battery: variant.battery } };
}

module.exports = { optimizeListing, inferPartType, hasCompatibleEvidence, hasSamsungServiceCode, buildDescription };
