function clean(v){return String(v??'').replace(/\s+/g,' ').trim();}
function esc(v){return clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function cap80(v){const s=clean(v);if(s.length<=80)return s;return s.slice(0,80).replace(/\s+\S*$/,'').trim();}
function uniq(a){return [...new Set(a.filter(Boolean).map(clean).filter(Boolean))];}

const PART_RULES=[
 ['Akku',/\bbattery\b|\bakku\b/i],['Display',/\bdisplay\b|\bscreen\b|\blcd\b|\boled\b|\btouchscreen\b/i],['Ladebuchse',/charging|charge port|dock connector|usb[ -]?c|ladebuchse/i],['Kamera',/\bcamera\b|kamera/i],['Gehäuse',/housing|rear cover|back cover|battery cover|gehäuse/i],['Flexkabel',/flex cable|\bflex\b/i],['Lautsprecher',/speaker|loudspeaker|earpiece|hörmuschel/i],['Mikrofon',/microphone|\bmic\b|mikrofon/i],['Antenne',/antenna|antenne/i],['Klebefolie',/adhesive|tape|kleber|klebefolie/i],['Taste',/button|power key|volume key|taste/i],['SIM Kartenleser',/sim reader|sim card reader|sim slot/i],['Vibrator',/vibrator|vibration motor|taptic/i],['Kopfhörerbuchse',/headphone|audio jack|klinke/i],['Mainboard',/mainboard|motherboard|logic board/i],['Rahmen',/middle frame|midframe|bezel|rahmen/i]
];
function inferPartType(text){for(const [name,re] of PART_RULES)if(re.test(clean(text)))return name;return 'Ersatzteil';}
function extractQuality(text){const t=clean(text);const out=[];if(/\boriginal\b|\bgenuine\b/i.test(t))out.push('Original');else if(/\boem\b/i.test(t))out.push('OEM');if(/with frame|mit rahmen/i.test(t))out.push('mit Rahmen');if(/without frame|ohne rahmen/i.test(t))out.push('ohne Rahmen');if(/service pack/i.test(t))out.push('Service Pack');return out;}
function extractColour(text){const pairs=[['Schwarz',/\bblack\b|schwarz/i],['Weiß',/\bwhite\b|weiß|weiss/i],['Blau',/\bblue\b|blau/i],['Grün',/\bgreen\b|grün/i],['Rot',/\bred\b|rot/i],['Gold',/\bgold\b/i],['Silber',/\bsilver\b|silber/i],['Violett',/purple|violet|violett/i],['Grau',/\bgray\b|\bgrey\b|grau/i]];for(const [name,re] of pairs)if(re.test(clean(text)))return name;return '';}
function modelFromTitle(title,brand,partType){let s=clean(title).replace(/\([^)]*\)/g,' ');for(const [,re] of PART_RULES)s=s.replace(re,' ');s=s.replace(/\boriginal\b|\bgenuine\b|\boem\b|with frame|without frame|service pack/ig,' ').replace(/[,:;|/]+/g,' ').replace(/\s+/g,' ').trim();if(brand)s=s.replace(new RegExp('^'+brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*','i'),'').trim();return s;}
function candidateScore(title,brand,model,partType,quality,colour){let score=0;const t=title.toLowerCase();if(brand&&t.includes(brand.toLowerCase()))score+=6;if(model&&t.includes(model.toLowerCase()))score+=8;if(partType&&t.includes(partType.toLowerCase()))score+=7;quality.forEach(x=>{if(t.includes(x.toLowerCase()))score+=2});if(colour&&t.includes(colour.toLowerCase()))score+=1;score-=Math.max(0,title.length-78)*2;score+=Math.min(title.length,70)/20;return score;}
function chooseTitle(facts){const {brand,model,partType,quality,colour,supplierTitle}=facts;const q=quality.join(' ');const candidates=uniq([
 [brand,model,partType,q,colour].filter(Boolean).join(' '),
 [q,brand,model,partType,colour].filter(Boolean).join(' '),
 [brand,model,partType,colour,q].filter(Boolean).join(' '),
 [brand,model,q,partType].filter(Boolean).join(' '),
 supplierTitle
]).map(cap80);candidates.sort((a,b)=>candidateScore(b,brand,model,partType,quality,colour)-candidateScore(a,brand,model,partType,quality,colour));return candidates[0]||cap80(supplierTitle);}
function confidence(f){let n=0,max=6;if(f.brand)n++;if(f.model)n++;if(f.partType!=='Ersatzteil')n++;if(f.partNumber)n++;if(f.ean)n++;if(f.supplierTitle.length>8)n++;return Math.round(n/max*100);}
function buildDescription(f,title){const known=[];known.push(`<li><strong>Artikel:</strong> ${esc(f.partType)}</li>`);if(f.brand)known.push(`<li><strong>Marke:</strong> ${esc(f.brand)}</li>`);if(f.model)known.push(`<li><strong>Kompatibilität:</strong> ${esc(f.model)}</li>`);if(f.quality.length)known.push(`<li><strong>Ausführung:</strong> ${esc(f.quality.join(', '))}</li>`);if(f.colour)known.push(`<li><strong>Farbe:</strong> ${esc(f.colour)}</li>`);if(f.partNumber)known.push(`<li><strong>Herstellernummer / SKU:</strong> ${esc(f.partNumber)}</li>`);if(f.ean)known.push(`<li><strong>EAN:</strong> ${esc(f.ean)}</li>`);known.push('<li><strong>Zustand:</strong> Neu</li>');return `<div><h2>${esc(title)}</h2><p>Passendes Ersatzteil für Smartphone- und Tablet-Reparaturen. Alle Angaben wurden ausschließlich aus den verfügbaren Artikeldaten übernommen.</p><ul>${known.join('')}</ul><p><strong>Lieferumfang:</strong> 1x Ersatzteil wie beschrieben.</p><p><strong>Wichtig:</strong> Bitte vergleichen Sie vor dem Kauf Modell, Teilenummer, Ausführung und ggf. Farbe mit Ihrem vorhandenen Bauteil.</p><hr><p><strong>ThePhoneSearch</strong> – Ersatzteile für Smartphone &amp; Tablet Reparaturen.</p></div>`;}

async function optimizeListing(p){
 const supplierTitle=clean(p.Description||p.PartNumber||'Ersatzteil');
 const brand=clean(p.Manufacturer||'');
 const partType=inferPartType(supplierTitle);
 const quality=extractQuality(supplierTitle);
 const colour=extractColour(supplierTitle);
 const model=modelFromTitle(supplierTitle,brand,partType);
 const partNumber=clean(p.PartNumber||p.Id||'');
 const ean=clean(p.EanNumber||'');
 const facts={supplierTitle,brand,model,partType,quality,colour,partNumber,ean};
 const title=chooseTitle(facts);
 const description=buildDescription(facts,title);
 return {supplierTitle,title,description,source:'local-smart-engine',confidence:confidence(facts),classification:{brand,model,partType,quality,colour},paidAi:false};
}

module.exports={optimizeListing,inferPartType};
