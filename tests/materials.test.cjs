const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..');
function context(html,materials=true){
  const ctx=vm.createContext({console,Intl,Date,Map,Set,JSON,Math,setTimeout:()=>0,clearTimeout:()=>{},localStorage:{getItem:()=>null,setItem:()=>{}},document:{getElementById:id=>id==='app'?{}:null,querySelectorAll:()=>[],createElement:()=>({classList:{add(){},remove(){}},remove(){}}),body:{appendChild(){}}},window:{addEventListener(){}},alert(){},confirm:()=>true});
  if(materials)vm.runInContext(fs.readFileSync(path.join(root,'material-model.js'),'utf8'),ctx);
  const script=html.match(/<script>\s*([\s\S]*?)<\/script>/)[1].replace(/^init\(\);$/m,'');vm.runInContext(script,ctx);return ctx;
}
const ctx=context(fs.readFileSync(path.join(root,'index.html'),'utf8'));
const run=code=>vm.runInContext(code,ctx),read=code=>JSON.parse(JSON.stringify(run(code)));
function setup(materials=['PVC'],regards=2){
  ctx.mats=materials;ctx.regards=regards;
  run(`PROJECT_CONFIG=blankProjectConfig('Test','Test','SIYO','PFO');PROJECT_CONFIG.localities=[{id:'a',nm:'Front A',z:'A',tot:1000*mats.length,regards,zones:mats.map((material,i)=>({zid:'Z'+i,nm:'Portion '+i,material,dn:{200:1000},tot:1000}))}];LOC=PROJECT_CONFIG.localities;ZN=['A'];PHYSICAL_WEIGHTS={...DEFAULT_PHYSICAL_WEIGHTS};db={};SD='2026-09-11';PARAM_DRAFT=null;`);
}
function report(values){ctx.values=values;run(`db[SD]={loc:{a:{topoDay:0,zones:Object.fromEntries(LOC[0].zones.map((z,i)=>[z.zid,{200:values[i]}]))}},finitions:{},eff:{},logistique:{},contraintes:[]};`);}
let count=0;function test(name,fn){fn();count++;console.log('PASS',name);}
test('PVC pose sans soudure : poids transféré et contrôle limité à la fouille',()=>{
  setup();report([{r:1000,f:1000}]);assert.ok(Math.abs(run('dashboardPhysicalSummary(cumul(SD)).index')-71.518)<1e-8);assert.equal(run('checkCoherence(cumul(SD)).length'),0);assert.equal(run('weldingVisible()'),false);assert.equal(run('continuityVisible()'),false);
});
test('Mixte même DN : soudure divisée seulement par le linéaire PEHD',()=>{
  setup(['PEHD','PVC']);report([{s:1000},{}]);assert.equal(run('dashboardPhysicalSummary(cumul(SD)).rates.assemblage'),100);assert.ok(Math.abs(run('dashboardPhysicalSummary(cumul(SD)).index')-16.8069)<1e-8);assert.deepEqual(Object.keys(read('dayDN(db[SD],"a")')),['PEHD:200','PVC:200']);
});
test('PVC terminé dans un réseau mixte : contribution propre à la pose',()=>{
  setup(['PEHD','PVC']);report([{}, {r:1000}]);assert.ok(Math.abs(run('dashboardPhysicalSummary(cumul(SD)).index')-23.58845)<1e-9);
});
test('Passage particulier : alerte sans plafonnement à la fouille',()=>{
  setup();report([{r:80}]);assert.equal(run('checkCoherence(cumul(SD))[0].type'),'R>F');assert.equal(run('safeCumul(cumul(SD)).a.r'),80);
});
test('PEHD : fouille indépendante, pose comparée à soudure et fouille',()=>{
  setup(['PEHD']);report([{f:1000}]);assert.equal(run('checkCoherence(cumul(SD)).length'),0);report([{f:1000,r:1000}]);assert.deepEqual(read('checkCoherence(cumul(SD)).map(a=>a.type)'),['R>S']);
});
test('Réseau mixte achevé : 100 %, regards comptés une seule fois',()=>{
  setup(['PEHD','PVC']);report([{s:1000,r:1000,f:1000,barDay:1000,ess:1000},{r:1000,f:1000,barDay:1000,ess:1000}]);run(`db[SD].loc.a.topoDay=2000;db[SD].loc.a.gc=2;db[SD].finitions={rincage:{a:{status:'valide'}}};`);assert.equal(run('dashboardPhysicalSummary(cumul(SD)).gcTotal'),2);assert.ok(Math.abs(run('dashboardPhysicalSummary(cumul(SD)).index')-100)<1e-8);
});
test('Projet sans regard : 100 % atteignable',()=>{
  setup(['PVC'],0);report([{r:1000,f:1000,barDay:1000,ess:1000}]);run(`db[SD].loc.a.topoDay=1000;db[SD].finitions={rincage:{a:{status:'valide'}}};`);assert.ok(Math.abs(run('dashboardPhysicalSummary(cumul(SD)).index')-100)<1e-8);
});
test('Correction et dépassement : conservation des bruts, plafonnement par portion',()=>{
  setup(['PVC']);report([{r:1200,f:1200}]);assert.equal(run('cumul(SD).a.r'),1200);assert.equal(run('dashboardPhysicalSummary(cumul(SD)).totals.rem'),1000);run(`db['2026-09-12']={loc:{a:{zones:{Z0:{200:{r:-300}}}}}}`);assert.equal(run('dashboardPhysicalSummary(cumul("2026-09-12")).totals.rem'),900);
});
test('Saisie PVC : aucun champ soudure ni valeur s dans le rapport collecté',()=>{
  setup();const html=run('pgSaisie()');assert.ok(!html.includes('id="s_a_'));assert.ok(html.includes('pvc-production'));assert.ok(!Object.hasOwn(read('collect().loc.a.zones.Z0[200]'),'s'));
});
test('Rapports et WhatsApp mixtes distinguent les matériaux du même DN',()=>{
  setup(['PEHD','PVC']);report([{s:100,f:100,r:50},{f:200,r:100}]);const html=run('pgRapport()');assert.ok(html.includes('PEHD DN 200'));assert.ok(html.includes('PVC DN 200'));assert.ok(html.includes('N/A'));const wa=run('pgWhatsapp()');assert.ok(wa.includes('PEHD DN 200'));assert.ok(wa.includes('PVC DN 200'));
});
test('Tableau mensuel de soudure : dénominateur PEHD et détail sans PVC',()=>{
  setup(['PEHD','PVC']);report([{s:1000},{r:1000}]);run(`DG_ACT_PIVOT='s';DG_LOC_DETAIL='a';`);const html=run(`renderMonthlyPivot(cumul(SD),['2026-09'])`);assert.ok(html.includes('100%'));assert.ok(!html.includes('PVC DN 200'));
});
test('Matériau historique verrouillé et activation ancienne bloquée',()=>{
  setup(['PEHD']);report([{s:100}]);run(`PARAM_DRAFT=JSON.parse(JSON.stringify(PROJECT_CONFIG));projectDraftMaterial('a',0,'PVC');`);assert.equal(run('PARAM_DRAFT.localities[0].zones[0].material'),'PEHD');run(`delete PROJECT_CONFIG.materialTracking;PARAM_DRAFT=JSON.parse(JSON.stringify(PROJECT_CONFIG));PARAM_DRAFT.materialTracking=1;`);assert.ok(run('projectConfigErrors(PARAM_DRAFT).some(s=>s.includes("migration"))'));
});
test('Export JSON converti : préserve les matériaux et la grille',()=>{
  setup(['PEHD','PVC']);ctx.raw={parametres:{materialTracking:1,LOC:read('LOC'),weights:read('PHYSICAL_WEIGHTS')}};assert.equal(run('configFromExportV1(raw,{name:"Test"}).materialTracking'),1);assert.equal(run('configFromExportV1(raw,{name:"Test"}).localities[0].zones[1].material'),'PVC');
});
// Optional exact baseline comparison, using the source checked out before this patch.
if(process.env.SIYO_BASELINE){
  const old=context(fs.readFileSync(process.env.SIYO_BASELINE,'utf8'),false);
  test('Dispersion historique : résultats identiques à la version source',()=>{
    const fixture=`PROJECT_CONFIG=defaultProjectConfig();LOC=PROJECT_CONFIG.localities;PHYSICAL_WEIGHTS={...DEFAULT_PHYSICAL_WEIGHTS};ETAT_INITIAL_DATE=PROJECT_CONFIG.initial.date;db={};for(let i=1;i<=3;i++){const loc={};LOC.forEach((l,li)=>{loc[l.id]={zones:{},gc:li%2};l.zones.forEach(z=>{loc[l.id].zones[z.zid]={};Object.entries(z.dn).forEach(([dn,p])=>{loc[l.id].zones[z.zid][dn]={s:p*.2,f:p*.15,r:p*.1,ess:p*.03};});});});db['2026-08-0'+i]={loc};}`;
    vm.runInContext(fixture,old);run(fixture);
    for(const code of ['dashboardPhysicalSummary(cumul("2026-08-03"))','indiceContinuite(cumul("2026-08-03"))','avancementPhysique(cumul("2026-08-03"))','LOC.map(l=>avancementLot(l,cumul("2026-08-03")[l.id]))','safeCumul(cumul("2026-08-03"))'])assert.equal(JSON.stringify(run(code)),JSON.stringify(vm.runInContext(code,old)),code);
  });
}
test('Exports Excel : matériau conservé, soudure PVC non applicable',()=>{
  setup(['PEHD','PVC']);report([{s:1000},{r:1000}]);
  const sheets=[];ctx.XLSX={utils:{book_new:()=>({}),aoa_to_sheet:rows=>({rows}),encode_cell:({r,c})=>r+':'+c,book_append_sheet:(wb,ws,name)=>sheets.push({name,rows:JSON.parse(JSON.stringify(ws.rows))})},writeFile(){}};
  run('exportExcelCumul()');assert.equal(sheets[0].rows[4][3],'PEHD');assert.equal(sheets[0].rows[5][3],'PVC');assert.equal(sheets[0].rows[5][7],'N/A');assert.ok(sheets[1].rows[1][0].includes('Regards comptés une seule fois'));
});
test('Kong sans PEHD : indicateurs et option de soudure masqués',()=>{
  setup(['PVC']);report([{f:100,r:100}]);const html=run('pgDG()');assert.ok(!html.includes('Indice de continuité'));assert.ok(!html.includes('Soudure PEHD retenue'));assert.ok(!html.includes("setDGActivity('s')"));
});
async function persistenceTest(){
  setup(['PEHD','PVC']);let stored;
  ctx.mockSb={from(table){const q={select(){return q},eq(){return q},order(){return q},limit(){return q},insert(row){if(table==='project_config')stored=JSON.parse(JSON.stringify(row));return q},update(){return q},upsert(){return q},then(resolve,reject){return Promise.resolve({data:table==='project_config'&&stored?[stored]:[],error:null}).then(resolve,reject)}};return q}};
  run(`sb=mockSb;SESSION={user:{id:'test-user'}};ACTIVE_PROJECT_ID='test-project';CURRENT_USER_CONTEXT={role:'lecteur'};PROJECT_REGISTRY.projects=[{id:ACTIVE_PROJECT_ID,name:'Test'}];`);
  assert.equal(await run(`pushProjectConfigVersion(ACTIVE_PROJECT_ID,PROJECT_CONFIG,'Configuration des matériaux')`),true);
  assert.equal(stored.config.materialTracking,1);assert.equal(stored.config.localities[0].zones[1].material,'PVC');
  const reloaded=await run('loadProjectConfigRemote(ACTIVE_PROJECT_ID)');assert.equal(reloaded.materialTracking,1);assert.equal(reloaded.localities[0].zones[1].material,'PVC');
  count++;console.log('PASS Configuration JSON : écriture et relecture simulées via les fonctions Supabase');console.log(count+' tests passed');
}
persistenceTest().catch(e=>{console.error(e);process.exitCode=1});
