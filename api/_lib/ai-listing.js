function clean(v){return String(v??'').replace(/\s+/g,' ').trim();}
function esc(v){return clean(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function cap80(v){const s=clean(v);if(s.length<=80)return s;return s.slice(0,80).replace(/\s+\S*$/,'').trim();}

function inferPartType(text){
 const t=clean(text).toLowerCase();
 if(/battery|akku/.test(t)) return 'Akku';
 if(/display|screen|lcd|oled/.test(t)) return 'Display';
 if(/charging|charge|dock connector|usb-c|usb c/.test(t)) return 'Ladebuchse';
 if(/camera/.test(t)) return 'Kamera';
 if(/housing|case|rear cover|back cover/.test(t)) return 'Gehäuse';
 if(/flex/.test(t)) return 'Flexkabel';
 if(/speaker|loudspeaker|earpiece|microphone|mic\b/.test(t)) return 'Lautsprecher';
 if(/antenna/.test(t)) return 'Antenne';
 if(/adhesive|tape/.test(t)) return 'Klebefolie';
 if(/button|key/.test(t)) return 'Taste';
 return 'Ersatzteil';
}

function fallback(p){
 const supplierTitle=clean(p.Description||p.PartNumber||'Ersatzteil');
 const brand=clean(p.Manufacturer||'');
 const partType=inferPartType(supplierTitle);
 const original=/\boriginal\b|\bgenuine\b|\boem\b/i.test(supplierTitle)?'Original':'';
 let model=supplierTitle.replace(/\([^)]*\)/g,' ').replace(/\boriginal\b|\bgenuine\b|\boem\b/ig,' ').replace(/\b(display|screen|lcd|oled|battery|akku|charging|charge|dock connector|usb-c|usb c|camera|housing|case|rear cover|back cover|flex cable|flex|speaker|loudspeaker|earpiece|microphone|antenna|adhesive|tape|button|key)\b/ig,' ').replace(/[,:;|]+/g,' ').replace(/\s+/g,' ').trim();
 if(brand) model=model.replace(new RegExp('^'+brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*','i'),'').trim();
 const title=cap80([original,brand,model,partType].filter(Boolean).join(' '))||cap80(supplierTitle);
 const sku=clean(p.PartNumber||p.Id||'');
 const ean=clean(p.EanNumber||'');
 const desc=`<div><h2>${esc(title)}</h2><p>Hochwertiges Ersatzteil für die professionelle Smartphone-Reparatur.</p><ul><li><strong>Artikel:</strong> ${esc(partType)}</li>${brand?`<li><strong>Marke:</strong> ${esc(brand)}</li>`:''}${sku?`<li><strong>Herstellernummer / SKU:</strong> ${esc(sku)}</li>`:''}${ean?`<li><strong>EAN:</strong> ${esc(ean)}</li>`:''}<li><strong>Zustand:</strong> Neu</li></ul><p><strong>Lieferumfang:</strong> 1x Ersatzteil wie beschrieben.</p><p>Bitte vergleichen Sie vor dem Kauf Modell, Teilenummer und Ausführung mit Ihrem Gerät.</p><hr><p><strong>ThePhoneSearch</strong> – Ersatzteile für Smartphone &amp; Tablet Reparaturen.</p></div>`;
 return {supplierTitle,title,description:desc,source:'smart-fallback'};
}

function extractOutputText(data){
 if(data?.output_text) return data.output_text;
 for(const item of data?.output||[]) for(const c of item?.content||[]) if(c?.type==='output_text'&&c?.text) return c.text;
 return '';
}

async function optimizeListing(p){
 const base=fallback(p);
 const key=process.env.OPENAI_API_KEY;
 if(!key) return base;
 const facts={supplierTitle:base.supplierTitle,manufacturer:clean(p.Manufacturer),partNumber:clean(p.PartNumber||p.Id),ean:clean(p.EanNumber),stock:Number(p.AvailableStockQuantity||0)};
 const prompt=`You optimize German eBay listings for mobile-phone spare parts. Return ONLY valid JSON with keys title and descriptionHtml.\nRules:\n- title maximum 80 characters, natural German eBay search wording, strongest keywords first.\n- Never invent compatibility, specifications, quality, OEM/original status, colour, capacity, model, MPN, EAN or features not supported by the facts.\n- If supplier wording is vague, keep the title conservative rather than guessing.\n- descriptionHtml must be clean eBay-safe HTML using h2, p, ul, li, strong, hr only.\n- Include product, known compatibility/details, condition Neu, Lieferumfang 1x, compatibility-check notice, and ThePhoneSearch trust footer.\n- Do not mention AI or MobileParts.\nFACTS: ${JSON.stringify(facts)}`;
 try{
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_LISTING_MODEL||'gpt-5.6-luna',input:prompt,max_output_tokens:900})});
  if(!r.ok) return {...base,source:'smart-fallback',aiError:`OpenAI HTTP ${r.status}`};
  const data=await r.json();
  const text=extractOutputText(data).trim().replace(/^```json\s*/i,'').replace(/```$/,'').trim();
  const parsed=JSON.parse(text);
  const title=cap80(parsed.title||base.title);
  const description=String(parsed.descriptionHtml||base.description).trim();
  return {supplierTitle:base.supplierTitle,title,description,source:'openai'};
 }catch(e){return {...base,source:'smart-fallback',aiError:e.message};}
}

module.exports={optimizeListing};