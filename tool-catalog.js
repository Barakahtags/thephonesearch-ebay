const partsRenderCats=renderCats;

renderCats=function(){
  if(articleType!==3)return partsRenderCats();
  cats.className='toolTree';
  cats.innerHTML=(window.TOOL_TAXONOMY||[]).map(([group,children])=>
    `<details class="toolGroup"><summary>${esc(group)}</summary><div class="toolChildren">${children.map(name=>
      `<button class="toolChild" data-tool-category="${esc(name)}">${esc(name)}</button>`
    ).join('')}</div></details>`
  ).join('');
  cats.querySelectorAll('[data-tool-category]').forEach(button=>button.addEventListener('click',()=>chooseToolCategory(button.dataset.toolCategory)));
};

changeType=function(n){
  articleType=n;
  [1,3].forEach(i=>document.getElementById('type'+i).classList.toggle('active',i===n));
  brand='';
  document.getElementById('model').value='';
  all=[];
  results.innerHTML='';
  count.textContent='';
  q.value='';
  document.getElementById('brandGroup').style.display=n===3?'none':'';
  document.getElementById('modelGroup').style.display=n===3?'none':'';
  heading.textContent=n===3?'Alle Werkzeuge':'Choose a brand and model';
  renderBrands();
  renderCats();
  runSearch();
};

async function chooseToolCategory(name){
  q.value=toolSearchTerm(name);
  heading.textContent='Werkzeuge → '+name;
  await runSearch();
}

function toolSearchTerm(name){
  const rules=[
    [/Batterie Info/i,'battery tester'],[/Arbeitsmatte/i,'silicone mat'],[/Fingerabdruck/i,'fingerprint calibrator'],
    [/Flüssigkeitsdispenser/i,'liquid dispenser'],[/Dichten|Klemmen/i,'clamp'],[/Heizplattform/i,'heating platform'],
    [/Greifen|Halten/i,'holding tool'],[/Klingen|Schneidende/i,'blade'],[/Pinzette/i,'tweezer'],
    [/Schraubendreherbits/i,'screwdriver bit'],[/Schraubendreher/i,'screwdriver'],[/Spudgers|Aufbrechen/i,'spudger'],
    [/Reinigung/i,'cleaning'],[/Glasabscheider/i,'glass separator'],[/Display polieren/i,'screen polish'],
    [/Polieren/i,'polishing'],[/Hinterglasreparatur Verbrauch/i,'back glass consumable'],[/Roter Faserlaser/i,'fiber laser'],
    [/Hinterglasreparatur/i,'back glass repair'],[/ESD-Erdung/i,'ESD grounding'],[/ESD-Handschuhe/i,'ESD gloves'],
    [/Doppelseitiger/i,'double sided adhesive'],[/Flüssigklebstoff/i,'liquid adhesive'],[/Schutzhülle/i,'protective cover'],
    [/Thermischer/i,'thermal adhesive'],[/iPhone 7 Plus/i,'iPhone 7 Plus PCB'],[/Mikroskop-Basen/i,'microscope base'],
    [/Mikroskop-Kameras/i,'microscope camera'],[/Mikroskop-Licht/i,'microscope light'],[/Objektive|Adapter/i,'microscope lens'],
    [/Mikroskopköpfe/i,'microscope head'],[/Aufbewahrungsbox/i,'storage box'],[/Bildschirm-Unterstützung/i,'screen support'],
    [/Gerät Organisation/i,'device organizer'],[/Holster/i,'screwdriver holster'],[/Schraubenorganisation/i,'screw organizer'],
    [/Presswerkzeug Akkus/i,'battery press'],[/Presswerkzeug Display/i,'screen press'],[/Repareren/i,'repair sustainable'],
    [/Boot Boxen/i,'boot box'],[/DC-Stromversorgung/i,'DC power supply'],[/Diagnostische/i,'diagnostic tool'],
    [/Multimeter/i,'multimeter'],[/Prüfvorrichtungen/i,'PCB tester'],[/USB-Verstärker/i,'USB amp meter'],
    [/Dunstabzug/i,'fume extractor'],[/E-learning/i,'e-learning'],[/In-house/i,'training'],
    [/USB-Dongles/i,'schematic dongle'],[/Handschuhe/i,'gloves'],[/Schutzbrille/i,'safety glasses'],
    [/Schutzschirm/i,'protective shield'],[/Staubfreier/i,'dust free'],[/BGA/i,'BGA stencil'],
    [/Heißluft/i,'hot air station'],[/Klebeband/i,'tape'],[/Kühlkörper und Isolatoren/i,'heat sink insulator'],
    [/Lötdraht|Docht/i,'solder wire wick'],[/UV|Epoxid/i,'UV epoxy'],[/Lötflussmittel|Legierungen/i,'solder flux'],
    [/Lötkolbenspitzen/i,'soldering tip'],[/Lötstationen/i,'soldering station'],[/Magnification/i,'magnification lamp'],
    [/PCB-Halter/i,'PCB holder'],[/PCB-Kühlkörper/i,'PCB heat sink'],[/PCB-Vorwärmer/i,'PCB preheater'],
    [/Praxis Motherboard/i,'practice motherboard'],[/Sonstiges Löt/i,'soldering consumable'],[/Wire \/ wick/i,'wire wick'],
    [/iPhone-Werkzeuge/i,'iPhone tool'],[/Ladeanschluss-Tester/i,'charging port tester']
  ];
  return rules.find(([pattern])=>pattern.test(name))?.[1]||name;
}
