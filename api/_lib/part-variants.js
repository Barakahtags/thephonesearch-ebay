function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

const FORBIDDEN_CUSTOMER_NAMES = /\b(?:mobile\s*parts(?:\.shop)?|mobileparts(?:\.shop)?|2\s*service|service\s*2b)\b/gi;

function customerSafe(value) {
  return clean(value).replace(FORBIDDEN_CUSTOMER_NAMES, '').replace(/\s{2,}/g, ' ').trim();
}

function flatten(value, output = []) {
  if (value == null) return output;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') output.push(String(value));
  else if (Array.isArray(value)) value.forEach(item => flatten(item, output));
  else if (typeof value === 'object') Object.values(value).forEach(item => flatten(item, output));
  return output;
}

function sourceText(part) {
  const fields = [part?.Description, part?.StatusText, part?.Quality, part?.Variant, part?.ProductVariant, part?.AdditionalDescription, part?.Remarks, part?.Options, part?.Features, part?.Specifications];
  return customerSafe(flatten(fields).join(' '));
}

const QUALITY = {
  original: { label: 'Original', title: 'Original', condition: 'Neu', original: true, description: 'Originalteil des angegebenen Geräteherstellers. Ausführung, Passform und technische Zuordnung entsprechen den angegebenen Produktdaten.' },
  service_pack: { label: 'Service Pack', title: 'Service Pack', condition: 'Neu', original: true, description: 'Apple-Ersatzteil aus einem alternativen Partner-Vertriebskanal. Technisch entspricht es der direkt bezogenen Ausführung; die Verkaufsbezeichnung bleibt Service Pack.' },
  best_possible: { label: 'Best Possible', title: 'Best Possible', condition: 'Je nach Ausführung', original: false, description: 'Beste verfügbare Ausführung dieser Produktgruppe. Sie kann je nach Artikel Factory Standard, Pulled, Refurbished oder Compatible sein; eine pauschale Originalzusage wird daraus nicht abgeleitet.' },
  factory_standard: { label: 'Factory Standard', title: 'Factory Standard', condition: 'Neu', original: false, description: 'Herstellerunabhängige Ersatzteilqualität nach Factory-Standard. Sie ist auf eine originalnahe Funktion und Passform ausgelegt, wurde jedoch nicht vom ursprünglichen Gerätehersteller gefertigt.' },
  pulled: { label: 'Pulled', title: 'Original Pulled', condition: 'Gebraucht', original: true, description: 'Gebrauchtes Originalteil, das aus einem Originalgerät ausgebaut wurde. Die Ausführung ist technisch original; sichtbare Gebrauchsspuren richten sich nach der angegebenen Qualitätsstufe.' },
  refurbished: { label: 'Refurbished', title: 'Refurbished', condition: 'Generalüberholt', original: false, originalPanel: true, description: 'Professionell aufgearbeitetes Display mit originalem LCD-/OLED-Panel. Frontglas und je nach Ausführung weitere Verschleißkomponenten wurden durch hochwertige Ersatzkomponenten erneuert.' },
  in_cell: { label: 'In-Cell', title: 'In-Cell LCD', condition: 'Neu', compatible: true, description: 'Hochwertiges kompatibles LCD-Display, bei dem die Touchfunktion in das LCD integriert ist. Es ist dünner und bietet eine bessere Bild- und Touchleistung als einfache kompatible LCD-Ausführungen. Kein Originalteil.' },
  compatible_soft: { label: 'Compatible Soft OLED', title: 'Soft OLED Compatible', condition: 'Neu', compatible: true, description: 'Hochwertiges kompatibles Soft-OLED mit flexiblem Panel, hoher Auflösung und guter Helligkeit. Es ist weniger bruchempfindlich als Hard-OLED. Kein Originalteil.' },
  compatible_hard: { label: 'Compatible Hard OLED', title: 'Hard OLED Compatible', condition: 'Neu', compatible: true, description: 'Kompatibles Hard-OLED mit guter Bildqualität und hoher Auflösung. Das starre Panel ist konstruktionsbedingt empfindlicher gegen Sturz- und Druckschäden als Soft-OLED. Kein Originalteil.' },
  compatible_budget: { label: 'Compatible Budget', title: 'Budget Compatible', condition: 'Neu', compatible: true, description: 'Preisgünstiges kompatibles Einstiegsdisplay. Helligkeit, Auflösung, Farbdarstellung und Blickwinkel können unter der Originalausführung und höherwertigen kompatiblen Varianten liegen. Kein Originalteil.' },
  compatible: { label: 'Compatible', title: 'Compatible', condition: 'Neu', compatible: true, description: 'Kompatibles Ersatzteil eines unabhängigen Herstellers. Es ist für das angegebene Modell vorgesehen, jedoch kein Originalteil des Geräteherstellers.' },
  unspecified: { label: '', title: '', condition: 'Neu', original: false, description: 'Die Qualitäts- und Ausführungsangaben werden ausschließlich aus den vorhandenen Produktdaten übernommen.' }
};

function samsungServiceCode(value) {
  return /\bGH\d{2}[-\s]?\d{3,}[A-Z]?\b/i.test(clean(value));
}

function detectQuality(part, partType) {
  const text = sourceText(part), sku = clean(part?.PartNumber || part?.Id), brand = clean(part?.Manufacturer);
  let code = 'unspecified';
  if (/service\s*pack/i.test(text)) code = 'service_pack';
  else if (/best\s*possible/i.test(text)) code = 'best_possible';
  else if (/factory\s*standard|\boem\b/i.test(text)) code = 'factory_standard';
  else if (/\bpulled\b/i.test(text)) code = 'pulled';
  else if (/\brefurb(?:ished)?\b/i.test(text)) code = 'refurbished';
  else if (/\bin[\s-]*cell\b/i.test(text)) code = 'in_cell';
  else if (/compatible\s*soft|soft[\s-]*oled/i.test(text)) code = 'compatible_soft';
  else if (/compatible\s*hard|hard[\s-]*oled/i.test(text)) code = 'compatible_hard';
  else if (/compatible\s*budget|budget\s*(?:lcd|display|screen)?/i.test(text)) code = 'compatible_budget';
  else if (/\bcompatible\b|\bcompatibel\b|\bkompatibel\b/i.test(text)) code = 'compatible';
  else if (/\boriginal\b|\bgenuine\b/i.test(text)) code = 'original';
  else if (/^samsung$/i.test(brand) && samsungServiceCode(`${sku} ${text}`)) code = 'original';
  const quality = { code, ...QUALITY[code] };
  if (code === 'pulled' && partType === 'Akkudeckel') {
    const gradeMatch = text.match(/\bpulled\s*(?:grade\s*)?([abc])\b|\bgrade\s*([abc])\b/i);
    quality.grade = (gradeMatch?.[1] || gradeMatch?.[2] || '').toUpperCase();
    if (quality.grade) quality.label += ` ${quality.grade}`;
  }
  return quality;
}

function optionState(text, positive, negative) {
  if (negative.test(text)) return 'without';
  if (positive.test(text)) return 'with';
  return '';
}

function detectOptions(part) {
  const text = sourceText(part);
  const framePreassembled = /frame\s*pre[\s-]*assembled|pre[\s-]*mounted\s+display\s+on\s+frame|vormontiert.*rahmen/i.test(text);
  return {
    frame: framePreassembled ? 'preassembled' : optionState(text, /with\s+frame|incl\.?\s*frame|including\s+frame|mit\s+rahmen/i, /without\s+frame|excl\.?\s*frame|ohne\s+rahmen/i),
    smallParts: optionState(text, /with\s+small\s+parts|incl\.?\s+small\s+parts|mit\s+kleinteilen/i, /without\s+small\s+parts|ohne\s+kleinteile/i),
    battery: optionState(text, /with\s+battery|battery\s+inserted|mit\s+akku/i, /without\s+battery|ohne\s+akku/i),
    camera: optionState(text, /with\s+camera(?:\s+unit)?|mounted\s+camera|mit\s+kamera/i, /without\s+camera|ohne\s+kamera/i),
    ic: optionState(text, /with\s+(?:swappable\s+)?ic|\bIC\s+included\b|mit\s+ic/i, /without\s+ic|\bWI\b|ohne\s+ic/i),
    adhesive: optionState(text, /with\s+adhesive|adhesive\s+(?:already\s+)?(?:placed|applied)|incl\.?\s+adhesive|mit\s+kleber/i, /without\s+adhesive|ohne\s+kleber/i),
    logo: optionState(text, /with\s+logo|mit\s+logo/i, /without\s+logo|ohne\s+logo/i),
    buttons: optionState(text, /with\s+buttons?|mit\s+tasten/i, /without\s+buttons?|ohne\s+tasten/i),
    soldering: /requires?\s+soldering|soldering\s+required|löten\s+erforderlich/i.test(text),
    sensorFlex: /with\s+sensor\s+flex|sensor\s+flex\s+included|-FLEX\b/i.test(text)
  };
}

function displayVersion(text, sku) {
  if (/\bLG\b/i.test(text) || /B[23]L$/i.test(sku)) return 'LG';
  if (/\bToshiba\b/i.test(text) || /B[23]T$/i.test(sku) || /TO$/i.test(sku)) return 'Toshiba';
  if (/\bSharp\b/i.test(text) || /B[23]S$/i.test(sku) || /SH$/i.test(sku)) return 'Sharp';
  return '';
}

function iphoneModel(text) {
  const match = clean(text).match(/\biPhone\s+(SE\s*(?:2020|2022|\([^)]*\))|(?:11|12|13|14|15|16|17)(?:e|\s+mini|\s+Plus|\s+Pro(?:\s+Max)?)?|Air)\b/i);
  return match ? clean(match[1]).replace(/\bpro\b/ig, 'Pro').replace(/\bmax\b/ig, 'Max').replace(/\bplus\b/ig, 'Plus').replace(/\bmini\b/ig, 'mini') : '';
}

function refreshRate(model, qualityCode) {
  if (!model || !['in_cell', 'compatible_soft', 'compatible_hard', 'compatible_budget'].includes(qualityCode)) return null;
  if (qualityCode === 'compatible_hard' || qualityCode === 'compatible_budget') return 60;
  if (qualityCode === 'compatible_soft') return /(?:13|14|15|16|17)\s+Pro/i.test(model) || /^17$/i.test(model) ? 120 : 60;
  if (/17\s+Pro/i.test(model)) return 120;
  if (/(?:13|14|15|16)\s+Pro/i.test(model) || /^17$/i.test(model)) return 90;
  return 60;
}

function displayCalibration(quality, options, sku) {
  if (quality.code === 'original' || quality.code === 'service_pack' || /B8$/i.test(sku)) return 'Genuine';
  if (options.sensorFlex && ['pulled', 'refurbished', 'compatible_soft', 'compatible_hard'].includes(quality.code)) return 'Used';
  if (['pulled', 'refurbished', 'in_cell', 'compatible_soft', 'compatible_hard', 'compatible_budget'].includes(quality.code)) return 'Unknown';
  return '';
}

function batteryVariant(text, sku, quality) {
  if (/without\s+bms|excl\.?\s*bms|4BMS$/i.test(`${text} ${sku}`)) return { code: 'without_bms', label: 'Ohne BMS', title: 'ohne BMS', calibration: 'Unknown', description: 'Lieferung ohne Battery-Management-System. Für die erwartete Batterieerkennung kann die fachgerechte Übertragung des originalen BMS erforderlich sein; das Ergebnis hängt von Modell, iOS-Version und Reparaturverfahren ab.' };
  if (/high[\s-]*capacity.*(?:used|calibrat)|4H-FLEX$/i.test(`${text} ${sku}`)) return { code: 'high_used', label: 'High Capacity, iOS18+ bereit', title: 'High Capacity', calibration: 'Used', description: 'Akku mit erhöhter Nennkapazität und vorbereiteter Kalibrierungsvariante. Nach erfolgreicher Kalibrierung kann iOS den Status „Used“ anzeigen; Kapazitätsanzeige und Zählerverhalten hängen von Modell und iOS-Version ab.' };
  if (/high[\s-]*capacity|4H$/i.test(`${text} ${sku}`)) return { code: 'high', label: 'High Capacity', title: 'High Capacity', calibration: quality.compatible ? 'Unknown' : '', description: 'Ausführung mit erhöhter Nennkapazität. Je nach Gerätemodell kann die angegebene Kapazität bis zu 25 % über der ursprünglichen Spezifikation liegen.' };
  if (quality.code === 'pulled' && /4P$/i.test(sku)) return { code: 'pulled_ready', label: 'Pulled, iOS18+ bereit', title: 'Pulled', calibration: 'Used', description: 'Gebrauchter Originalakku in der angegebenen Kapazitätsstufe. Nach erfolgreicher Kalibrierung kann iOS den Status „Used“ anzeigen.' };
  return { code: 'normal', label: 'Standardakku', title: '', calibration: quality.compatible ? 'Unknown' : (quality.original ? 'Genuine' : ''), description: 'Standardausführung als zuverlässiger Ersatzakku für den täglichen Einsatz.' };
}

const DOC_BATTERY_SKU = /^(?:AP|IPAD)[A-Z0-9£-]*(?:04|4P|4H|4BMS|4H-FLEX)$/i;
function complianceCovered(partType, sku) { return partType === 'Akku' && DOC_BATTERY_SKU.test(clean(sku).replace(/\s+/g, '')); }
const DOC_DISPLAY_SKU = /^AP[A-Z0-9£-]*B[357](?:-(?:JK|MS|FLEX))?$/i;
function displayComplianceCovered(partType, sku) { return partType === 'Display' && DOC_DISPLAY_SKU.test(clean(sku).replace(/\s+/g, '')); }

function pulledGradeDetails(grade) {
  if (grade === 'A') return 'Qualitätsstufe A: höchstens zwei kleine Punkte von 1–2 mm, maximal 15 nicht fühlbare Kratzer, höchstens zwei kleine Farbabweichungen und kein Lackverlust.';
  if (grade === 'B') return 'Qualitätsstufe B: kleine Punkte oder geringe Lackverluste, mehr als 15 nicht fühlbare Kratzer und sichtbare Farbabweichungen sind möglich.';
  if (grade === 'C') return 'Qualitätsstufe C: größere Punkte oder Schrammen ab etwa 3 mm, fühlbare Kratzer, deutliche Farbabweichungen und stärkerer Lackverlust sind möglich.';
  return '';
}

function optionDetails(options) {
  const details = [];
  const add = (state, withText, withoutText) => { if (state === 'with') details.push(withText); else if (state === 'without') details.push(withoutText); };
  if (options.frame === 'preassembled') details.push('Display auf Rahmen vormontiert.'); else add(options.frame, 'Mit Rahmen.', 'Ohne Rahmen.');
  add(options.smallParts, 'Mit vormontierten Kleinteilen.', 'Ohne Kleinteile.');
  add(options.battery, 'Mit eingesetztem Akku.', 'Ohne Akku.'); add(options.camera, 'Mit montierter Kameraeinheit.', 'Ohne Kameraeinheit.');
  add(options.ic, 'Mit IC.', 'Ohne IC; die fachgerechte Übertragung des vorhandenen IC kann erforderlich sein.');
  add(options.adhesive, 'Mit bereits angebrachtem Kleber.', 'Ohne Kleber.'); add(options.logo, 'Mit Logo.', 'Ohne Logo.'); add(options.buttons, 'Mit Tasten.', 'Ohne Tasten.');
  if (options.soldering) details.push('Für den Einbau sind Lötarbeiten erforderlich.');
  return details;
}

function analyseVariant(part, partType) {
  const text = sourceText(part), sku = clean(part?.PartNumber || part?.Id), quality = detectQuality(part, partType), options = detectOptions(part);
  const model = iphoneModel(`${part?.Description || ''} ${text}`);
  const display = partType === 'Display' ? { version: displayVersion(text, sku), calibration: displayCalibration(quality, options, sku), refreshRate: refreshRate(model, quality.code) } : null;
  const battery = partType === 'Akku' ? batteryVariant(text, sku, quality) : null;
  const details = optionDetails(options), grade = pulledGradeDetails(quality.grade);
  if (grade) details.push(grade); if (display?.version) details.push(`Displayversion: ${display.version}.`);
  if (display?.refreshRate) details.push(`Angegebene Bildwiederholrate dieser Ersatzdisplay-Ausführung: ${display.refreshRate} Hz.`);
  if (display?.calibration) details.push(`Mögliche iOS 18+ Teilemeldung nach erfolgreicher Kalibrierung: „${display.calibration}“. Die tatsächliche Anzeige hängt von Modell, iOS-Version, IC und Reparaturverfahren ab.`);
  if (battery) details.unshift(battery.description);
  if (battery?.calibration) details.push(`Mögliche iOS 18+ Batteriemeldung nach erfolgreicher Kalibrierung: „${battery.calibration}“.`);
  return {
    sourceText: text, quality, options, display, battery, details,
    complianceCovered: complianceCovered(partType, sku),
    displayComplianceCovered: displayComplianceCovered(partType, sku),
    testBeforeAssembly: partType === 'Display'
  };
}

module.exports = { analyseVariant, customerSafe, detectQuality, complianceCovered, displayComplianceCovered, samsungServiceCode, sourceText };
