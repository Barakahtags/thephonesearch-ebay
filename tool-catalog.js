const partsRenderCats=renderCats;

renderCats=function(){
  if(articleType!==3)return partsRenderCats();
  cats.className='toolTree';
  cats.innerHTML=(window.TOOL_TAXONOMY||[]).map(([group,children])=>
    `<section class="toolGroup"><h4>${esc(group)}</h4><div class="toolChildren">${children.map(name=>
      `<button class="toolChild" data-tool-category="${esc(name)}">${esc(name)}</button>`
    ).join('')}</div></section>`
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
  q.value=name;
  heading.textContent='Werkzeuge → '+name;
  await runSearch();
}
