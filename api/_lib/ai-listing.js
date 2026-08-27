function clean(v){return String(v??'').replace(/\s+/g,' ').trim();}
function esc(v){return clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function cap80(v){const s=clean(v);if(s.length<=80)return s;return s.slice(0,80).replace(/\s+\S*$/,'').trim();}
function uniq(a){return [...new Set(a.filter(Boolean).map(clean).filter(Boolean))];}

const PART_RULES=[
 ['Akku',/\bbattery\b|\bakku\b/i],['Display',/\bdisplay\b|\bscreen\b|\blcd\b|\boled\b|\btouchscreen\b/i],['Ladebuchse',/charging|charge port|dock connector|usb[ -]?c|ladebuchse/i],['Kamera',/\bcamera\b|kamera/i],['Kameraglas',/camera (?:glass|lens)|kameraglas/i],['Akkudeckel',/rear cover|back cover|battery cover|akkudeckel|rückseite/i],['Gehäuse',/housing|gehäuse/i],['Flexkabel',/flex cable|\bflex\b/i],['Lautsprecher',/speaker|loudspeaker|earpiece|hörmuschel/i],['Mikrofon',/microphone|\bmic\b|mikrofon/i],['Antenne',/antenna|antenne/i],['Klebestreifen',/adhesive\s*(?:str(?:ip)?s?)?|glue\s*strip|klebestreifen/i],['Klebefolie',/adhesive|tape|kleber|klebefolie/i],['Schutzglas',/tempered glass|screen protector|protective glass|schutzglas/i],['Taste',/button|power key|volume key|taste/i],['SIM Kartenleser',/sim reader|sim card reader|sim slot/i],['Vibrator',/vibrator|vibration motor|taptic/i],['Kopfhörerbuchse',/headphone|audio jack|klinke/i],['Mainboard',/mainboard|motherboard|logic board/i],['Rahmen',/middle frame|midframe|bezel|rahmen/i],['Schraubendreher',/screwdriver|schraubendreher/i],['Pinzette',/tweezer|pinzette/i],['Lötzubehör',/solder|soldering|flux|löten|lötzubehör/i],['Werkzeug',/tool|opening|spudger|repair kit|werkzeug|screws? storage tray|magnetic tray/i]
];
const PRECISE_PART_RULES=[
 ['Klebestreifen',/adhesive\s*(?:str(?:ip)?s?)?|glue\s*strip|klebestreifen/i],
 ['Kameraglas',/camera (?:glass|lens)|kameraglas/i],
 ['Schutzglas',/tempered glass|screen protector|protective glass|schutzglas/i],
 ['Akkudeckel',/rear cover|back cover|battery cover|akkudeckel|rückseite/i],
 ['Ladebuchse',/charging board|charging port|charge port|dock connector|ladebuchse/i]
];
function inferPartType(text){const s=clean(text);for(const [name,re] of PRECISE_PART_RULES)if(re.test(s))return name;for(const [name,re] of PART_RULES)if(re.test(s))return name;return 'Ersatzteil';}
const ENGLISH_ALIAS={
 'Akku':'Battery','Display':'Screen','Ladebuchse':'Charging Port','Kamera':'Camera','Kameraglas':'Camera Glass','Akkudeckel':'Backcover','Gehäuse':'Housing',
 'Flexkabel':'Flex Cable','Lautsprecher':'Speaker','Mikrofon':'Microphone','Antenne':'Antenna',
 'Klebestreifen':'Adhesive Strip','Klebefolie':'Adhesive','Schutzglas':'Screen Protector','Taste':'Button','SIM Kartenleser':'SIM Reader','Vibrator':'Vibration Motor',
 'Kopfhörerbuchse':'Audio Jack','Mainboard':'Logic Board','Rahmen':'Frame','Schraubendreher':'Screwdriver','Pinzette':'Tweezers','Lötzubehör':'Soldering','Werkzeug':'Repair Tool','Ersatzteil':'Spare Part'
};
const TITLE_KEYWORDS={
 'Akku':['Akku','Batterie','Battery','Ersatzakku','Replacement'],
 'Display':['Display','Screen','LCD','Touchscreen'],
 'Ladebuchse':['Ladebuchse','Charging Port','Charging Flex','Ladeflex'],
 'Kamera':['Kamera','Camera','Modul'],
 'Kameraglas':['Kameraglas','Camera Glass','Linse','Lens'],
 'Akkudeckel':['Akkudeckel','Rückseite','Backcover','Deckel'],
 'Gehäuse':['Gehäuse','Housing','Backcover'],
 'Flexkabel':['Flexkabel','Flex Cable','Folie'],
 'Lautsprecher':['Lautsprecher','Speaker','Buzzer'],
 'Mikrofon':['Mikrofon','Microphone','Mic'],
 'Antenne':['Antenne','Antenna','Signal Flex'],
 'Klebestreifen':['Klebestreifen','Adhesive Strip','Klebefolie','Display Montage'],
 'Klebefolie':['Klebefolie','Adhesive','Kleber','Montage'],
 'Schutzglas':['Schutzglas','Panzerglas','Screen Protector','Tempered Glass'],
 'Taste':['Taste','Button','Key Flex'],
 'SIM Kartenleser':['SIM Kartenleser','SIM Reader','Slot'],
 'Vibrator':['Vibrator','Vibration Motor','Taptic'],
 'Kopfhörerbuchse':['Kopfhörerbuchse','Audio Jack','Klinke'],
 'Mainboard':['Mainboard','Motherboard','Logic Board'],
 'Rahmen':['Rahmen','Frame','Mittelrahmen'],
 'Schraubendreher':['Schraubendreher','Screwdriver','Repair Tool'],
 'Pinzette':['Pinzette','Tweezers','Reparatur Werkzeug'],
 'Lötzubehör':['Lötzubehör','Soldering','Löten','Repair Tool'],
 'Werkzeug':['Werkzeug','Repair Tool','Reparatur Tool'],
 'Ersatzteil':['Ersatzteil','Spare Part']
};
function extractQuality(text){const t=clean(text);const out=[];if(/\boriginal\b|\bgenuine\b/i.test(t))out.push('Original');else if(/\boem\b/i.test(t))out.push('OEM');if(/with frame|incl\.?\s*frame|including frame|mit rahmen/i.test(t))out.push('mit Rahmen');if(/without frame|excl\.?\s*frame|ohne rahmen/i.test(t))out.push('ohne Rahmen');if(/service pack/i.test(t))out.push('Service Pack');return out;}
function hasCompatibleEvidence(text){return /\bcompatible\b|\bcompatibel\b|\bkompatibel\b|\breplacement\b|\bsuitable\s+for\b|\bpassend\s+für\b|\bmade\s+for\b|(?:^|[,:;\-])\s*for\s+[a-z0-9]/i.test(clean(text));}
function hasSamsungServiceCode(text){return /\bGH\d{2}[-\s]?\d{3,}[A-Z]?\b/i.test(clean(text));}
function extractColour(text){const pairs=[['Schwarz',/\bblack\b|schwarz/i],['Weiß',/\bwhite\b|weiß|weiss/i],['Blau',/\bblue\b|blau/i],['Grün',/\bgreen\b|grün/i],['Rot',/\bred\b|rot/i],['Gold',/\bgold\b/i],['Silber',/\bsilver\b|silber/i],['Violett',/purple|violet|violett/i],['Grau',/\bgray\b|\bgrey\b|grau/i]];for(const [name,re] of pairs)if(re.test(clean(text)))return name;return '';}
function modelFromTitle(title,brand,partType){let s=clean(title).replace(/\([^)]*\)/g,' ');for(const [,re] of PRECISE_PART_RULES)s=s.replace(re,' ');for(const [,re] of PART_RULES)s=s.replace(re,' ');s=s.replace(/\bbattery\b|\bscreen\b|\bdisplay\b|\blcd\b|\boled\b|\btouchscreen\b|\bcharging board\b|\bcharge board\b|\bflex cable\b|\bspeaker\b|\bmicrophone\b|\bantenna\b|\badhesive\b|\bsim reader\b|\bvibration motor\b|\baudio jack\b|\blogic board\b|\bhousing\b|\bcamera\b/ig,' ');if(partType==='Ladebuchse')s=s.replace(/\bboard\b|\bport\b|\bdock\b/ig,' ');s=s.replace(/\bcompatible\b|\bcompatibel\b|\bkompatibel\b|\breplacement\b|\bsuitable\s+for\b|\bpassend\s+für\b|\bmade\s+for\b/ig,' ').replace(/\boriginal\b|\bgenuine\b|\boem\b|with frame|incl\.?\s*frame|including frame|without frame|excl\.?\s*frame|service pack|\bblack\b|\bwhite\b|\bblue\b|\bgreen\b|\bred\b|\bgold\b|\bsilver\b|\bgray\b|\bgrey\b|\bpurple\b|\bschwarz\b|\bweiß\b|\bweiss\b|\bblau\b|\bgrün\b|\brot\b|\bsilber\b|\bviolett\b|\bgrau\b/ig,' ').replace(/[,:;|/\-]+/g,' ').replace(/\s+/g,' ').trim().replace(/^(for|für)\s+/i,'');if(brand){const escaped=brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');s=s.replace(new RegExp('^(?:'+escaped+'\\s*)+','i'),'').trim()}return s;}
function candidateScore(title,brand,model,partType,quality,colour){let score=0;const t=title.toLowerCase();if(brand&&t.includes(brand.toLowerCase()))score+=6;if(model&&t.includes(model.toLowerCase()))score+=8;if(partType&&t.includes(partType.toLowerCase()))score+=7;quality.forEach(x=>{if(t.includes(x.toLowerCase()))score+=2});if(colour&&t.includes(colour.toLowerCase()))score+=1;score-=Math.max(0,title.length-78)*2;score+=Math.min(title.length,70)/20;return score;}
function chooseTitle(facts){const {brand,model,partType,quality,colour,isCompatible}=facts;const isOriginal=quality.includes('Original'),features=quality.filter(x=>x!=='Original'&&x!=='OEM');const prefix=isOriginal?'Original':isCompatible?'Für':'';const required=[prefix,brand,model].filter(Boolean);let title=required.join(' ');const additions=uniq([...(TITLE_KEYWORDS[partType]||TITLE_KEYWORDS.Ersatzteil),...features,colour]);for(const word of additions){const next=clean(title+' '+word);if(next.length<=80)title=next;}return cap80(title);}
function confidence(f){let n=0,max=6;if(f.brand)n++;if(f.model)n++;if(f.partType!=='Ersatzteil')n++;if(f.partNumber)n++;if(f.ean)n++;if(f.supplierTitle.length>8)n++;return Math.round(n/max*100);}
function buildDescription(f,title){const known=[],keywords=TITLE_KEYWORDS[f.partType]||TITLE_KEYWORDS.Ersatzteil,alias=keywords.slice(1).join(', '),isOriginal=f.quality.includes('Original'),displayQuality=f.quality.filter(x=>x!=='OEM');known.push(`<li><strong>Artikel:</strong> ${esc(f.partType)} (${esc(alias)})</li>`);if(f.brand)known.push(`<li><strong>${f.isCompatible?'Passend für Marke':'Marke / Hersteller'}:</strong> ${esc(f.brand)}</li>`);if(f.model)known.push(`<li><strong>${f.isCompatible?'Kompatibilität':'Modell / Zuordnung'}:</strong> ${esc(f.model)}</li>`);if(displayQuality.length)known.push(`<li><strong>Ausführung:</strong> ${esc(displayQuality.join(', '))}</li>`);if(f.colour)known.push(`<li><strong>Farbe:</strong> ${esc(f.colour)}</li>`);if(f.partNumber)known.push(`<li><strong>Herstellernummer / SKU:</strong> ${esc(f.partNumber)}</li>`);if(f.ean)known.push(`<li><strong>EAN:</strong> ${esc(f.ean)}</li>`);known.push('<li><strong>Zustand:</strong> Neu</li>');const originNotice=isOriginal?'<p><strong>Originalteil:</strong> Die Originalangabe wurde aus den Lieferantendaten übernommen.</p>':f.isCompatible?'<p><strong>Hinweis:</strong> Die Kompatibilitätsangabe wurde aus den Lieferantendaten übernommen.</p>':'<p><strong>Hinweis:</strong> Originalität oder Kompatibilität wird nur angegeben, wenn dies ausdrücklich in den Lieferantendaten steht.</p>';return `<div><h2>${esc(title)}</h2><p>${f.isCompatible?'Passendes':'Angebotenes'} ${esc(f.partType)} für Smartphone-, Tablet- oder Elektronikreparaturen. Relevante Artikelbegriffe: ${esc(keywords.join(', '))}. Alle Produktangaben stammen aus den verfügbaren Lieferantendaten.</p>${originNotice}<ul>${known.join('')}</ul><p><strong>Lieferumfang:</strong> 1x ${esc(f.partType)} wie beschrieben.</p><p><strong>Wichtig:</strong> Bitte vergleichen Sie vor dem Kauf Marke, Modell, Teilenummer, Ausführung und Farbe mit Ihrem vorhandenen Bauteil.</p><hr><p><strong>ThePhoneSearch</strong> – Ersatzteile und Werkzeuge für Smartphone- &amp; Tablet-Reparaturen.</p></div>`;}

async function optimizeListing(p){
 const supplierTitle=clean(p.Description||p.PartNumber||'Ersatzteil');
 const rawBrand=clean(p.Manufacturer||''),brand=/^other$/i.test(rawBrand)?'':rawBrand;
 const partType=inferPartType(supplierTitle);
 const quality=extractQuality(supplierTitle);
 const colour=extractColour(supplierTitle);
 const model=modelFromTitle(supplierTitle,brand,partType);
 const partNumber=clean(p.PartNumber||p.Id||'');
 const ean=clean(p.EanNumber||'');
 const isSamsungCode=hasSamsungServiceCode(`${partNumber} ${supplierTitle}`);
 const isCompatible=!quality.includes('Original')&&hasCompatibleEvidence(supplierTitle);
 const facts={supplierTitle,brand,model,partType,quality,colour,partNumber,ean,isCompatible,isSamsungCode};
 const title=chooseTitle(facts);
 const description=buildDescription(facts,title);
 return {supplierTitle,title,description,source:'local-smart-engine',confidence:confidence(facts),classification:{brand,model,partType,quality,colour,isCompatible,isSamsungCode},paidAi:false};
}

module.exports={optimizeListing,inferPartType,hasCompatibleEvidence,hasSamsungServiceCode};
