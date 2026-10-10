import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SOURCE = 'https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html';
const systemNames = {bones:'骨格',muscles:'筋肉',organs:'臓器',vessels:'血管',nerves:'神経',other:'体表・その他'};
const systemEnglish = {bones:'SKELETAL',muscles:'MUSCULAR',organs:'ORGAN',vessels:'VASCULAR',nerves:'NERVOUS',other:'SURFACE / OTHER'};
const icons = {
  bones:'<path d="m8 8 8 8M6 3c-4 0-4 6 0 6l9 9c0 4 6 4 6 0 0-2-1-3-3-3L9 6c0-2-1-3-3-3Z"/>',
  muscles:'<path d="M4 19c3-6 2-10 6-13 4-3 8 1 7 5-1 4-5 3-7 7-2 3-4 4-6 1ZM11 7l3 5M8 10l4 6M5 15l3 4"/>',
  organs:'<path d="M12 20S3 14 3 8c0-5 7-6 9-1 2-5 9-4 9 1 0 6-9 12-9 12Z"/>',
  vessels:'<path d="M12 2v20M12 8 6 5V2M12 13l6-4V3M12 17l-6-3v8M18 22v-5l-6-3"/>',
  nerves:'<path d="M12 2v7m0 6v7M2 12h7m6 0h7M5 5l5 5m4 4 5 5M19 5l-5 5m-4 4-5 5"/><circle cx="12" cy="12" r="3"/>',
  other:'<path d="M8 4c-3 4-4 8-3 12 1 6 13 6 14 0 1-4 0-8-3-12M8 4c0 3 8 3 8 0M8 10v6m8-6v6"/>'
};
const state = {systems:new Set(['bones','organs']),hidden:new Set(),selected:new Set(),entity:null,isolated:false,ghost:false,mode:'body',explode:0,inventoryPage:0,query:'',browse:false,listLimit:70,ready:false};
let atlas, content, renderer, scene, camera, controls, previewRenderer, previewScene, previewCamera, previewGroup;
let parts = [], groups = [], meshes = [], byId = new Map(), materials = new Map(), bodyCenter, bodyHeight;
let dirty = true, moving = false, cameraTween = null, toastTimer, nextKey = 'leftLung', lastTime = 0;
let inventoryParts = [], hoverTick = 0, previewDirty = true, frameCount = 0;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const colorInk = new THREE.Color('#245b50');

function notify(text) {
  $('status').textContent=text; $('status').hidden=false;
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('status').hidden=true,3600);
}
function el(tag, attrs={}, text='') {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,value);
  node.textContent=text;return node;
}
function material(color, kind='normal') {
  const key=color+kind;
  if(!materials.has(key)) {
    const m=new THREE.MeshStandardMaterial({color,roughness:.69,metalness:.015});
    if(kind==='selected'){m.emissive=colorInk;m.emissiveIntensity=.16;m.roughness=.53;}
    if(kind==='ghost'){m.transparent=true;m.opacity=.075;m.depthWrite=false;m.color.lerp(new THREE.Color('#e5e7d7'),.56);}
    materials.set(key,m);
  }
  return materials.get(key);
}
function sceneLights(target) {
  target.add(new THREE.HemisphereLight(0xfffbf0,0x93a18d,2.1));
  const key=new THREE.DirectionalLight(0xfff7e8,3.0);key.position.set(-2.5,4,5);target.add(key);
  const fill=new THREE.DirectionalLight(0xdce8ea,1.8);fill.position.set(3,1,-2);target.add(fill);
  const rim=new THREE.DirectionalLight(0xffffff,1.4);rim.position.set(-2,-1,-4);target.add(rim);
}
function initThree() {
  renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setClearColor(0,0);
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.domElement.setAttribute('aria-hidden','true');$('viewport').prepend(renderer.domElement);
  scene=new THREE.Scene();sceneLights(scene);
  camera=new THREE.PerspectiveCamera(38,1,.003,100);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.10;
  controls.minDistance=.025;controls.maxDistance=18;controls.autoRotateSpeed=.55;
  controls.addEventListener('change',()=>{dirty=true;});
  controls.addEventListener('start',()=>{cameraTween=null;});
  previewRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.6));previewRenderer.setClearColor(0,0);
  previewRenderer.toneMapping=THREE.ACESFilmicToneMapping;previewRenderer.toneMappingExposure=1.1;
  previewRenderer.domElement.setAttribute('aria-hidden','true');$('detail-preview').prepend(previewRenderer.domElement);
  previewScene=new THREE.Scene();sceneLights(previewScene);
  previewCamera=new THREE.PerspectiveCamera(37,1,.0001,10);
  previewGroup=new THREE.Group();previewScene.add(previewGroup);
  new ResizeObserver(resize).observe($('viewport'));
  new ResizeObserver(resize).observe($('detail-preview'));
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();notify('3D表示が中断されました。ページを再読み込みしてください。');});
  let startPointer=null;
  renderer.domElement.addEventListener('pointerdown',e=>{startPointer={x:e.clientX,y:e.clientY};});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(!state.ready||!startPointer||Math.hypot(e.clientX-startPointer.x,e.clientY-startPointer.y)>5)return;
    const hit=pick(e); if(hit) selectPart(hit.object.userData.part.id);
  });
  renderer.domElement.addEventListener('pointermove',e=>{
    if(!state.ready||e.buttons||e.pointerType==='touch'){ $('hover-label').hidden=true;return; }
    if(performance.now()-hoverTick<100)return;hoverTick=performance.now();
    const hit=pick(e),label=$('hover-label');
    if(!hit){label.hidden=true;return;}
    const p=hit.object.userData.part,rect=$('viewport').getBoundingClientRect();
    label.textContent=p.name;label.hidden=false;
    label.style.left=Math.min(e.clientX-rect.left+14,rect.width-235)+'px';
    label.style.top=Math.min(e.clientY-rect.top+15,rect.height-55)+'px';
  });
  renderer.domElement.addEventListener('pointerleave',()=>{$('hover-label').hidden=true;});
  resize();requestAnimationFrame(animate);
}
function resize(){
  if(!renderer)return;
  const w=$('viewport').clientWidth,h=$('viewport').clientHeight;
  if(w&&h){renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();dirty=true;}
  const pw=$('detail-preview').clientWidth,ph=$('detail-preview').clientHeight;
  if(pw&&ph){previewRenderer.setSize(pw,ph,false);previewCamera.aspect=pw/ph;previewCamera.updateProjectionMatrix();previewDirty=true;}
}
function pick(e) {
  const rect=renderer.domElement.getBoundingClientRect();
  pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const candidates=meshes.filter(m=>m.visible&&(!state.ghost||state.selected.has(m.userData.part.id)));
  return raycaster.intersectObjects(candidates,false)[0];
}
function animate(time){
  requestAnimationFrame(animate);
  if(document.hidden){lastTime=time;return;}
  const dt=Math.min((time-lastTime)/1000,.06)||.016;lastTime=time;
  controls.update(dt);
  if(moving){
    let unfinished=false;
    const blend=reducedMotion?1:1-Math.exp(-dt*8);
    for(const m of meshes){
      if(!m.visible)continue;
      m.position.lerp(m.userData.target,blend);
      const sc=THREE.MathUtils.lerp(m.scale.x,m.userData.targetScale,blend);m.scale.setScalar(sc);
      if(m.position.distanceToSquared(m.userData.target)>1e-8||Math.abs(sc-m.userData.targetScale)>.0001)unfinished=true;
      else {m.position.copy(m.userData.target);m.scale.setScalar(m.userData.targetScale);}
    }
    moving=unfinished;dirty=true;
  }
  if(cameraTween){
    const t=reducedMotion?1:Math.min(1,(time-cameraTween.start)/620),ease=1-(1-t)**3;
    camera.position.lerpVectors(cameraTween.from,cameraTween.to,ease);
    controls.target.lerpVectors(cameraTween.targetFrom,cameraTween.targetTo,ease);
    controls.update();dirty=true;if(t>=1)cameraTween=null;
  }
  if(dirty){renderer.render(scene,camera);dirty=false;frameCount++;}
  if(previewDirty){previewRenderer.render(previewScene,previewCamera);previewDirty=false;}
}
async function loadGeometry(){
  const order=['bones','organs','muscles','vessels','nerves','other'];let loaded=0;
  for(const sys of order){
    $('load-detail').textContent=`${systemNames[sys]}のデータを準備しています…`;
    const response=await fetch(`./assets/${sys}.bin.gz`);if(!response.ok)throw new Error(`${sys}: HTTP ${response.status}`);
    const raw=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    const subset=parts.filter(p=>p.system===sys);
    for(let i=0;i<subset.length;i++){
      const p=subset[i],geo=new THREE.BufferGeometry();
      geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(raw,p.offset,p.vertices*3),3));
      geo.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(raw,p.offset+p.vertices*12,p.vertices*3),3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(raw,p.offset+p.vertices*24,p.indices),1));
      geo.computeBoundingBox();geo.computeBoundingSphere();
      const mesh=new THREE.Mesh(geo,material(p.color));
      const home=new THREE.Vector3(...p.center).sub(bodyCenter);
      mesh.position.copy(home);mesh.userData={part:p,home,target:home.clone(),targetScale:1};
      mesh.visible=state.systems.has(p.system);p.mesh=mesh;meshes.push(mesh);scene.add(mesh);
      loaded++;if(i%100===0){$('load-progress').style.width=`${loaded/parts.length*100}%`;await new Promise(requestAnimationFrame);}
    }
    dirty=true;
  }
}
function renderSystems(){
  $('systems').replaceChildren();
  for(const sys of atlas.systems){
    const b=el('button',{class:'system-button'+(state.systems.has(sys.id)?' active':''),'aria-pressed':String(state.systems.has(sys.id)),'data-system':sys.id});
    const icon=el('span',{class:'system-symbol','aria-hidden':'true'});icon.innerHTML=`<svg viewBox="0 0 24 24">${icons[sys.id]}</svg>`;
    b.append(icon,el('span',{},sys.title),el('span',{class:'count'},String(sys.count)),el('span',{class:'system-check','aria-hidden':'true'},'✓'));
    b.addEventListener('click',()=>{
      state.systems.has(sys.id)?state.systems.delete(sys.id):state.systems.add(sys.id);
      state.isolated=false;state.inventoryPage=0;renderSystems();updateLayout();renderList();
      if(state.mode==='inventory')fitView();
    });$('systems').append(b);
  }
}
function aliases(p){
  const g=groups.find(g=>g.id===p.group);
  return `${p.name} ${p.id} ${p.concept} ${p.representation} ${systemNames[p.system]} ${g?.title||''} ${g?.name||''}`.toLowerCase();
}
function matchedParts(){return parts.filter(p=>!state.query||aliases(p).includes(state.query));}
function renderList(){
  const list=$('part-list');list.replaceChildren();
  const q=state.query;const featured=!state.browse&&!q;
  const entries=featured?groups:matchedParts();
  $('list-heading').textContent=featured?'主な部位':q?'検索結果':'すべての部品';
  $('result-count').textContent=featured?'07':`${entries.length.toLocaleString()} 件`;
  $('browse-all').textContent=state.browse?'主な部位に戻る ←':'すべての部品を探す ↗';
  const groupResults=q?groups.filter(g=>`${g.title} ${g.name} ${g.id}`.toLowerCase().includes(q)):[];
  for(const entry of [...groupResults,...entries.slice(0,state.listLimit)]){
    const group=!!entry.members;
    const active=state.entity?.id===entry.id;
    const b=el('button',{class:'part-row'+(active?' selected':''),'aria-pressed':String(active)});
    const dot=el('span',{class:'part-dot','aria-hidden':'true'});dot.style.background=entry.color;
    const label=el('span',{class:'row-label'},group?entry.title:entry.name);
    label.append(el('small',{},group?`${entry.name} / ${entry.members.length} pieces`:`${entry.id} · ${systemNames[entry.system]}`));
    b.append(dot,label,el('span',{class:'arrow','aria-hidden':'true'},'↗'));
    b.addEventListener('click',()=>group?selectGroup(entry.id,{focus:true}):selectPart(entry.id,{focus:true}));list.append(b);
  }
  if(!entries.length&&!groupResults.length)list.append(el('p',{class:'empty-results'},'該当する部位が見つかりません。英語名、主要部位の日本語名、またはFJ番号で検索できます。'));
  if(entries.length>state.listLimit){const more=el('button',{class:'more-results'},'さらに70件を表示 ↓');more.addEventListener('click',()=>{state.listLimit+=70;renderList();});list.append(more);}
}
function selectGroup(id,{focus=false}={}){
  const group=groups.find(g=>g.id===id);if(!group)return;
  state.entity={...group,type:'group'};state.selected=new Set(group.members);state.hidden.forEach(x=>{if(state.selected.has(x))state.hidden.delete(x);});
  for(const id of group.members)state.systems.add(byId.get(id).system);
  if(state.mode==='inventory'){setMode('body',false);}
  renderSystems();updateLayout();renderList();renderDetail();
  if(focus){state.ghost=true;$('ghost').checked=true;updateLayout();focusSelected();}
  history.replaceState(null,'',`#${group.id}`);
}
function selectPart(id,{focus=false}={}){
  const p=byId.get(id);if(!p)return;
  state.entity={...p,type:'part'};state.selected=new Set([p.id]);state.hidden.delete(p.id);state.systems.add(p.system);
  renderSystems();updateLayout();renderList();renderDetail();if(focus)focusSelected();
}
function renderDetail(){
  const e=state.entity;if(!e)return;
  const group=e.type==='group'?e:groups.find(g=>g.id===e.group);
  const info=content[group?.id]||content[e.system];
  const title=e.type==='group'?e.title:e.name;
  $('selection-kind').textContent=e.type==='group'?'部位の解説':'個別部品';
  $('detail-title').textContent=title;$('detail-title').classList.toggle('long',e.type==='part');
  $('detail-en').textContent=e.type==='group'?e.name:e.id;
  const sys=e.type==='group'?'organs':e.system;
  $('detail-system').textContent=`${systemNames[sys]} / ${systemEnglish[sys]}`;
  $('detail-description').textContent=info?.description||'原典の解剖モデルに含まれる部品です。形状や周囲との位置関係を、回転・分解・単独表示で観察できます。';
  $('description-scope').hidden=e.type==='group'||!info;
  $('description-scope').textContent=info?`上記は「${info.title}」の概要です。この個別部品だけの説明ではありません。`:'';
  $('detail-meta').textContent=e.type==='group'?`構成：${e.members.length}部品  /  ${e.concepts.join(', ')}`:`${e.concept}  /  ${e.representation}  /  BodyParts3D 4.0`;
  $('description-source').textContent=info?`${info.sourceTitle} ↗`:'原典の部品一覧 ↗';
  $('description-source').href=info?.sourceUrl||SOURCE;
  nextKey=groups[(Math.max(0,groups.findIndex(g=>g.id===group?.id))+1)%groups.length].id;
  $('next-organ').textContent=`次は、${groups.find(g=>g.id===nextKey).title}を見てみよう →`;
  updateIsolateButton();updatePreview();
}
function updatePreview(){
  if(!state.ready)return;
  previewGroup.clear();
  const box=new THREE.Box3();
  for(const id of state.selected){const p=byId.get(id);box.expandByPoint(new THREE.Vector3(...p.center).addScaledVector(new THREE.Vector3(...p.size),.5));box.expandByPoint(new THREE.Vector3(...p.center).addScaledVector(new THREE.Vector3(...p.size),-.5));}
  const center=box.getCenter(new THREE.Vector3());
  for(const id of state.selected){
    const p=byId.get(id);if(!p.mesh)continue;
    const clone=new THREE.Mesh(p.mesh.geometry,material(p.color));clone.position.set(...p.center).sub(center);previewGroup.add(clone);
  }
  previewGroup.rotation.set(0,-.32,0);
  const s=box.getSize(new THREE.Vector3()),radius=Math.max(s.x,s.y,s.z,.01),aspect=previewCamera.aspect;
  const distance=radius/2/Math.tan(THREE.MathUtils.degToRad(37/2))*1.35/Math.min(1,aspect);
  previewCamera.position.set(distance*.12,distance*.10,distance);previewCamera.lookAt(0,0,0);previewCamera.updateProjectionMatrix();previewDirty=true;
}
function updateIsolateButton(){
  $('isolate').textContent=state.isolated?'全体表示に戻す ↙':'この部位だけを見る ↗';
  $('isolate').setAttribute('aria-pressed',String(state.isolated));
  $('hide-part').textContent=[...state.selected].every(x=>state.hidden.has(x))?'再表示する':'非表示にする';
}
function updateLayout({immediate=false}={}){
  if(!state.ready)return;
  inventoryParts=parts.filter(p=>state.systems.has(p.system)&&!state.hidden.has(p.id)&&(!state.isolated||state.selected.has(p.id))&&(!state.query||aliases(p).includes(state.query)));
  const pages=Math.max(1,Math.ceil(inventoryParts.length/48));state.inventoryPage=Math.min(state.inventoryPage,pages-1);
  const page=inventoryParts.slice(state.inventoryPage*48,(state.inventoryPage+1)*48),slots=new Map(page.map((p,i)=>[p.id,i]));
  const cols=8,rows=Math.ceil(page.length/cols),spacing=.19;
  let visible=0;
  for(const p of parts){
    const m=p.mesh;if(!m)continue;
    const chosen=state.selected.has(p.id);
    m.visible=state.systems.has(p.system)&&!state.hidden.has(p.id)&&(!state.isolated||chosen);
    if(state.mode==='inventory')m.visible=slots.has(p.id);
    m.material=material(p.color,state.ghost&&!chosen?'ghost':chosen?'selected':'normal');
    m.renderOrder=state.ghost&&!chosen?1:0;
    m.userData.target.copy(m.userData.home);m.userData.targetScale=1;
    if(state.mode==='inventory'&&m.visible){
      const i=slots.get(p.id);m.userData.target.set((i%cols-(cols-1)/2)*spacing,((rows-1)/2-Math.floor(i/cols))*spacing,0);
      m.userData.targetScale=.135/Math.max(...p.size,.001);
    }else if(state.mode==='body'&&state.explode>0){
      const home=m.userData.home,scale=state.explode/100;
      const idN=Number(p.id.replace(/\D/g,''));
      const angle=idN*2.399963;
      const radial=new THREE.Vector3(home.x*2+Math.cos(angle)*.075,home.y*.24,home.z*1.5+Math.sin(angle)*.13);
      radial.normalize().multiplyScalar(.20*scale);
      m.userData.target.add(new THREE.Vector3(home.x*1.7*scale,home.y*.33*scale,home.z*1.7*scale)).add(radial);
    }
    if(immediate||!m.visible){m.position.copy(m.userData.target);m.scale.setScalar(m.userData.targetScale);}
    if(m.visible)visible++;
  }
  $('visible-count').textContent=visible.toLocaleString();
  $('inventory-page').textContent=`${state.inventoryPage+1} / ${pages}`;
  $('inventory-prev').disabled=state.inventoryPage===0;$('inventory-next').disabled=state.inventoryPage>=pages-1;
  $('model-badge').textContent=state.mode==='inventory'?'部品一覧 / 縮尺を調整':state.isolated?'単独表示':'全身 / 探索';
  $('viewport').dataset.visible=String(visible);$('viewport').dataset.mode=state.mode;$('viewport').dataset.explode=String(state.explode);
  moving=!immediate;dirty=true;updateIsolateButton();
}
function selectedBounds(){
  const box=new THREE.Box3();
  for(const id of state.selected){
    const p=byId.get(id);if(!p?.mesh)continue;
    const m=p.mesh,s=new THREE.Vector3(...p.size).multiplyScalar(m.userData.targetScale*.5);
    box.expandByPoint(m.userData.target.clone().sub(s));box.expandByPoint(m.userData.target.clone().add(s));
  }return box;
}
function visibleBounds(){
  const box=new THREE.Box3();
  for(const m of meshes){if(!m.visible)continue;const s=new THREE.Vector3(...m.userData.part.size).multiplyScalar(m.userData.targetScale*.5);box.expandByPoint(m.userData.target.clone().sub(s));box.expandByPoint(m.userData.target.clone().add(s));}return box;
}
function frameBox(box,direction=null,immediate=false){
  if(box.isEmpty()){notify('表示する系統を選んでください。');return;}
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
  const vfov=THREE.MathUtils.degToRad(camera.fov),height=Math.max(size.y,size.x/camera.aspect,.02);
  let distance=height/(2*Math.tan(vfov/2))*1.25+size.z*.65;
  if(state.mode==='body'&&!state.isolated&&height>1)distance*=1.08;
  const dir=direction||camera.position.clone().sub(controls.target).normalize();
  const to=center.clone().addScaledVector(dir,distance);
  if(immediate||reducedMotion){camera.position.copy(to);controls.target.copy(center);controls.update();dirty=true;cameraTween=null;}
  else cameraTween={start:performance.now(),from:camera.position.clone(),to,targetFrom:controls.target.clone(),targetTo:center};
}
function fitView(immediate=false){frameBox(visibleBounds(),state.mode==='inventory'?new THREE.Vector3(0,0,1):null,immediate);}
function focusSelected(){
  if([...state.selected].some(id=>!byId.get(id).mesh.visible)&&state.mode==='inventory'){setMode('body',false);}
  frameBox(selectedBounds(),new THREE.Vector3(.10,.015,1).normalize());
  if(matchMedia('(max-width: 590px)').matches)$('explorer').scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'start'});
}
function setMode(mode,fit=true){
  state.mode=mode;state.inventoryPage=0;
  if(mode==='inventory'){state.ghost=false;$('ghost').checked=false;}
  $('body-mode').classList.toggle('active',mode==='body');$('inventory-mode').classList.toggle('active',mode==='inventory');
  $('body-mode').setAttribute('aria-pressed',String(mode==='body'));$('inventory-mode').setAttribute('aria-pressed',String(mode==='inventory'));
  $('explode-controls').hidden=mode!=='body';$('inventory-controls').hidden=mode!=='inventory';
  document.querySelectorAll('.body-side,.ruler').forEach(x=>x.hidden=mode==='inventory');
  updateLayout({immediate:mode==='inventory'});if(fit)fitView();
  if(mode==='inventory')notify('表示中の系統を48部品ずつ並べています。大きさは比較用に揃えています。');
}
function reset(){
  if(!state.ready)return;
  state.systems=new Set(['bones','organs']);state.hidden.clear();state.isolated=false;state.ghost=false;state.explode=0;state.query='';state.browse=false;state.listLimit=70;
  $('search').value='';$('ghost').checked=false;$('explode').value='0';$('explode-value').textContent='0%';controls.autoRotate=false;$('rotate-button').setAttribute('aria-pressed','false');
  document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view==='front');b.setAttribute('aria-pressed',String(b.dataset.view==='front'));});
  setMode('body',false);selectGroup('heart');updateLayout({immediate:true});
  frameBox(visibleBounds(),new THREE.Vector3(0,0,1));notify('初期の配置と表示に戻しました。');
}
function bindUI(){
  $('search').addEventListener('input',e=>{state.query=e.target.value.trim().toLowerCase();state.listLimit=70;state.inventoryPage=0;renderList();if(state.mode==='inventory'){updateLayout({immediate:true});fitView();}});
  $('browse-all').addEventListener('click',()=>{state.browse=!state.browse;state.query='';$('search').value='';state.listLimit=70;renderList();});
  $('all-systems').addEventListener('click',()=>{state.systems=new Set(atlas.systems.map(s=>s.id));state.isolated=false;renderSystems();updateLayout();renderList();fitView();notify('体表を含むすべての系統を表示しました。内部は「周囲を透かして見る」で観察できます。');});
  $('explode').addEventListener('input',e=>{state.explode=Number(e.target.value);$('explode-value').textContent=state.explode+'%';updateLayout();});
  $('explode').addEventListener('change',()=>{if(state.explode>30&&!state.isolated)fitView();});
  $('reset').addEventListener('click',reset);
  $('body-mode').addEventListener('click',()=>setMode('body'));
  $('inventory-mode').addEventListener('click',()=>setMode('inventory'));
  for(const [id,delta] of [['inventory-prev',-1],['inventory-next',1]])$(id).addEventListener('click',()=>{state.inventoryPage+=delta;updateLayout({immediate:true});fitView();});
  $('isolate').addEventListener('click',()=>{state.isolated=!state.isolated;for(const id of state.selected)state.hidden.delete(id);updateLayout();state.isolated?focusSelected():fitView();});
  $('focus-part').addEventListener('click',()=>{for(const id of state.selected)state.hidden.delete(id);updateLayout();focusSelected();});
  $('hide-part').addEventListener('click',()=>{
    const hidden=[...state.selected].every(x=>state.hidden.has(x));
    for(const id of state.selected)hidden?state.hidden.delete(id):state.hidden.add(id);
    if(state.isolated)state.isolated=false;updateLayout();notify(hidden?'選択した部位を再表示しました。':'選択した部位を非表示にしました。「再表示する」で戻せます。');
  });
  $('ghost').addEventListener('change',e=>{state.ghost=e.target.checked;updateLayout();});
  $('next-organ').addEventListener('click',()=>selectGroup(nextKey,{focus:true}));
  $('fit-view').addEventListener('click',()=>fitView());
  $('zoom-in').addEventListener('click',()=>zoom(.78));$('zoom-out').addEventListener('click',()=>zoom(1.28));
  $('rotate-button').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;$('rotate-button').setAttribute('aria-pressed',String(controls.autoRotate));dirty=true;});
  document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{
    document.querySelectorAll('[data-view]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});
    const dir={front:new THREE.Vector3(0,0,1),back:new THREE.Vector3(0,0,-1),side:new THREE.Vector3(1,0,0)}[b.dataset.view];
    frameBox(state.isolated?selectedBounds():visibleBounds(),dir);
  }));
  $('viewport').addEventListener('keydown',e=>{
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)){
      e.preventDefault();cameraTween=null;const off=camera.position.clone().sub(controls.target),sph=new THREE.Spherical().setFromVector3(off);
      if(e.key==='ArrowLeft')sph.theta-=.13;if(e.key==='ArrowRight')sph.theta+=.13;
      if(e.key==='ArrowUp')sph.phi-=.10;if(e.key==='ArrowDown')sph.phi+=.10;sph.makeSafe();
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));controls.update();dirty=true;
    }if(e.key==='+'||e.key==='='){e.preventDefault();zoom(.82);}if(e.key==='-'){e.preventDefault();zoom(1.22);}if(e.key.toLowerCase()==='r'){reset();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement.tagName!=='INPUT'&&!document.querySelector('dialog[open]')){e.preventDefault();$('search').focus();}});
}
function zoom(scale){cameraTween=null;camera.position.sub(controls.target).multiplyScalar(scale).add(controls.target);controls.update();dirty=true;}
for(const [button,dialog] of [['help-button','help-dialog'],['credits-button','credits-dialog'],['footer-credits','credits-dialog']])$(button).addEventListener('click',()=>$(dialog).showModal());
document.querySelectorAll('dialog').forEach(d=>{
  d.querySelectorAll('.dialog-close,.dialog-close-action').forEach(b=>b.addEventListener('click',()=>d.close()));
  d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
});

async function boot(){
  try{
    [atlas,content]=await Promise.all([fetch('./assets/atlas.json').then(r=>{if(!r.ok)throw new Error('データ目録を読めませんでした');return r.json();}),fetch('./assets/content.json').then(r=>r.json())]);
    parts=atlas.parts;groups=atlas.groups;byId=new Map(parts.map(p=>[p.id,p]));
    bodyCenter=new THREE.Vector3(...atlas.bounds[0]).add(new THREE.Vector3(...atlas.bounds[1])).multiplyScalar(.5);bodyHeight=atlas.bounds[1][1]-atlas.bounds[0][1];
    $('total-count').textContent=parts.length.toLocaleString();initThree();
    camera.position.set(0,.025,3);controls.target.set(0,0,0);controls.update();
    await loadGeometry();state.ready=true;bindUI();renderSystems();
    const requested=location.hash.slice(1);selectGroup(groups.some(g=>g.id===requested)?requested:'heart');
    updateLayout({immediate:true});frameBox(visibleBounds(),new THREE.Vector3(.05,0,1).normalize(),true);
    $('loader').hidden=true;$('viewport').dataset.ready='true';
    document.body.dataset.loadedParts=String(meshes.length);document.body.dataset.modelSource='BodyParts3D 4.0';
    window.atlasDiagnostics=()=>({ready:state.ready,total:parts.length,loaded:meshes.length,visible:meshes.filter(m=>m.visible).length,mode:state.mode,explode:state.explode,selected:[...state.selected],hidden:state.hidden.size,isolated:state.isolated,systems:[...state.systems],assemblyError:Math.max(...meshes.filter(m=>m.visible).map(m=>m.position.distanceTo(m.userData.home))),renderFrames:frameCount,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls});
  }catch(error){
    console.error(error);$('loader').hidden=false;$('loader').classList.add('error');
    $('loader').replaceChildren(el('strong',{},'3Dデータを開けませんでした'),el('p',{},'start.cmd から起動し、WebGL対応のブラウザで開いてください。'),el('small',{},String(error.message)));
    const retry=el('button',{class:'primary-button'},'もう一度読み込む');retry.addEventListener('click',()=>location.reload());$('loader').append(retry);
  }
}
boot();
