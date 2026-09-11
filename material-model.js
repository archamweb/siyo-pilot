// Versioned opt-in: old project configurations retain the original PEHD calculation.
function materialTracking(cfg=PROJECT_CONFIG){return cfg?.materialTracking===1;}
function zoneMaterial(zone){return zone?.material==='PVC'?'PVC':'PEHD';}
function weldedZone(zone){return zoneMaterial(zone)==='PEHD';}
function pehdLength(locs=LOC){return locs.reduce((sum,l)=>sum+l.zones.filter(weldedZone).reduce((n,z)=>n+Object.values(z.dn).reduce((a,b)=>a+(+b||0),0),0),0);}
function weldingVisible(locs=LOC){return !materialTracking()||pehdLength(locs)>0;}
function continuityVisible(){return !materialTracking();}
function zoneCaption(z){return (z.nm||z.zid)+(materialTracking()?' · '+zoneMaterial(z):'');}
function pipeLabel(key){const parts=String(key).split(':');return parts.length>1?parts[0]+' DN '+parts[1]:'DN '+key;}
function pipeNumber(key){return String(key).split(':').at(-1);}
function pipeDailyKey(z,dn){return materialTracking()?zoneMaterial(z)+':'+dn:String(dn);}
function physicalWeightsFor(material,base){const w={...base};if(material==='PVC'){w.fermeture=(+w.fermeture||0)+(+w.assemblage||0);w.assemblage=0;}return w;}
function materialSummary(locs,cu,base=PHYSICAL_WEIGHTS){
  const totals={bar:0,soud:0,fou:0,rem:0,ess:0},byMaterial={PEHD:{planned:0,s:0,r:0},PVC:{planned:0,s:0,r:0}};
  let tP=0,topoLength=0,gcDone=0,gcProgressTotal=0,gcTotal=0,rdLength=0,recolementDone=0,recolementLength=0;
  const cap=(v,p)=>Math.min(Math.max(Number(v)||0,0),p);
  for(const l of locs){
    const c=cu[l.id]||{};tP+=l.tot;topoLength+=cap(c.imp,1)*l.tot;
    gcTotal+=l.regards||0;gcDone+=cap(c.gc,l.regards||0);gcProgressTotal+=cap(c.gcProgress,l.regards||0);
    if(c.rincageStatus==='valide')rdLength+=l.tot;
    if(c.recolementStatus==='valide'||+c.rec>=1){recolementDone++;recolementLength+=l.tot;}
    for(const z of l.zones)for(const [dn,p] of Object.entries(z.dn)){
      const prev=+p||0,d=c.zones?.[z.zid]?.dn?.[dn]||{},m=byMaterial[zoneMaterial(z)];
      m.planned+=prev;m.r+=cap(d.r,prev);
      if(weldedZone(z)){m.s+=cap(d.s,prev);totals.soud+=cap(d.s,prev);}
      totals.bar+=cap(d.bar,prev);totals.fou+=cap(d.f,prev);totals.rem+=cap(d.r,prev);totals.ess+=cap(d.ess,prev);
    }
  }
  const pct=v=>tP?v/tP*100:0;
  const rates={topographie:pct(topoLength),bardage:pct(totals.bar),assemblage:byMaterial.PEHD.planned?totals.soud/byMaterial.PEHD.planned*100:0,ouverture:pct(totals.fou),fermeture:pct(totals.rem),gc:gcTotal?gcProgressTotal/gcTotal*100:0,essais:pct(totals.ess),rincage:pct(rdLength),recolement:locs.length?recolementDone/locs.length*100:0};
  const common=['topographie','bardage','ouverture','essais','rincage'];
  let points=common.reduce((s,k)=>s+(+base[k]||0)*rates[k]/100,0);
  if(tP)points+=((+base.assemblage||0)*byMaterial.PEHD.s+(+base.fermeture||0)*byMaterial.PEHD.r+((+base.assemblage||0)+(+base.fermeture||0))*byMaterial.PVC.r)/tP;
  if(gcTotal)points+=(+base.gc||0)*rates.gc/100;
  const applicableKeys=Object.keys(base).filter(k=>k!=='gc'||gcTotal>0),weight=applicableKeys.reduce((s,k)=>s+(+base[k]||0),0);
  return{tP,totals,byMaterial,pehdPlanned:byMaterial.PEHD.planned,topoLength,gcDone,gcProgressTotal,gcTotal,rdLength,recolementDone,recolementLength,rates,index:weight?points/weight*100:0,applicableKeys:applicableKeys.filter(k=>k!=='assemblage'||byMaterial.PEHD.planned>0)};
}
function projectDraftMaterial(id,zoneIndex,value){
  if(!PARAM_DRAFT||!['PEHD','PVC'].includes(value))return;
  const z=PARAM_DRAFT.localities.find(l=>l.id===id)?.zones[zoneIndex];if(!z)return;
  if(zoneHasHistory(id,z.zid)){alert('Le matériau de cette portion possède un historique. Il ne peut pas être réinterprété.');draw();return;}
  if(!materialTracking(PARAM_DRAFT)&&dbDates().length){alert('L’activation sur un projet historique nécessite une migration vérifiée. Le calcul existant est conservé.');draw();return;}
  PARAM_DRAFT.materialTracking=1;
  PARAM_DRAFT.localities.forEach(l=>l.zones.forEach(zone=>{if(!zone.material)zone.material='PEHD';}));
  z.material=value;saveProjectDraft();draw();
}
function renderMaterialSelector(loc,z,zi){
  const locked=zoneHasHistory(loc.id,z.zid),cfg=activeProjectParamConfig();
  if(!PARAM_DRAFT)return `<span class="material-tag">${materialTracking(cfg)?zoneMaterial(z):'PEHD · historique'}</span>`;
  return `<label class="material-selector">Matériau <select class="fi" aria-label="Matériau du sous-tronçon" ${locked?'disabled':''} onchange="projectDraftMaterial('${loc.id}',${zi},this.value)">${!materialTracking(cfg)?'<option value="" selected>PEHD · historique</option>':''}<option value="PEHD" ${materialTracking(cfg)&&zoneMaterial(z)==='PEHD'?'selected':''}>PEHD</option><option value="PVC" ${z.material==='PVC'?'selected':''}>PVC</option></select></label>`;
}
function materialReportRows(rp,locs){
  return locs.flatMap(l=>l.zones.flatMap(z=>Object.keys(z.dn).map(dn=>({l,z,dn,d:rp?.loc?.[l.id]?.zones?.[z.zid]?.[dn]||{}}))));
}
function renderMaterialDaily(zone,locs,rp){
  const weld=weldingVisible(locs),rows=materialReportRows(rp,locs).filter(x=>['s','f','r','ess'].some(k=>(k!=='s'||weldedZone(x.z))&&+x.d[k]));
  let h=`<div class="cd"><div class="ct">Activités du jour — ${escHtml(zone)}</div><div style="overflow-x:auto"><table class="tb"><thead><tr><th>Front</th><th>Sous-tronçon</th><th>Conduite</th>${weld?'<th>Soudure PEHD</th>':''}<th>Fouille</th><th>Pose</th><th>Essai</th></tr></thead><tbody>`;
  for(const {l,z,dn,d} of rows)h+=`<tr><td>${escHtml(l.nm)}</td><td>${escHtml(z.nm)}</td><td>${zoneMaterial(z)} DN ${dn}</td>${weld?`<td>${weldedZone(z)?fmt(+d.s||0):'N/A'}</td>`:''}<td>${fmt(+d.f||0)}</td><td>${fmt(+d.r||0)}</td><td>${fmt(+d.ess||0)}</td></tr>`;
  h+='</tbody></table></div>';
  if(!rows.length)h+='<p>Aucune production linéaire renseignée ce jour.</p>';
  for(const l of locs){const p=rp?.loc?.[l.id]?.p;if(p)h+=`<p><b>${escHtml(l.nm)} — pièces et raccords :</b> ${escHtml(p)}</p>`;}
  return h+'</div>';
}
function renderMaterialCumulative(zone,locs,cu){
  const weld=weldingVisible(locs),s=materialSummary(locs,cu),cell=(v,p)=>`${fmt(v)} ml · ${pc(v,p).toFixed(1)} %`;
  let h=`<div class="cd"><div class="ct">Cumul — ${escHtml(zone)}</div><div style="overflow-x:auto"><table class="tb"><thead><tr><th>Front / portion</th><th>Prévu</th>${weld?'<th>Soudure PEHD</th>':''}<th>Fouille</th><th>Pose</th><th>Essais</th></tr></thead><tbody>`;
  for(const l of locs){
    const ls=materialSummary([l],cu);h+=`<tr><td><b>${escHtml(l.nm)}</b></td><td>${fmt(l.tot)}</td>${weld?`<td>${ls.pehdPlanned?cell(ls.totals.soud,ls.pehdPlanned):'N/A'}</td>`:''}<td>${cell(ls.totals.fou,l.tot)}</td><td>${cell(ls.totals.rem,l.tot)}</td><td>${cell(ls.totals.ess,l.tot)}</td></tr>`;
    if(REPORT_SHOW_TECHNICAL)for(const z of l.zones)for(const [dn,p] of Object.entries(z.dn)){
      const d=cu[l.id]?.zones?.[z.zid]?.dn?.[dn]||{};
      h+=`<tr><td>${escHtml(zoneCaption(z))} · DN ${dn}</td><td>${fmt(p)}</td>${weld?`<td>${weldedZone(z)?cell(+d.s||0,p):'N/A'}</td>`:''}<td>${cell(+d.f||0,p)}</td><td>${cell(+d.r||0,p)}</td><td>${cell(+d.ess||0,p)}</td></tr>`;
    }
  }
  return h+`<tr><td><b>Total retenu</b></td><td>${fmt(s.tP)}</td>${weld?`<td>${cell(s.totals.soud,s.pehdPlanned)}</td>`:''}<td>${cell(s.totals.fou,s.tP)}</td><td>${cell(s.totals.rem,s.tP)}</td><td>${cell(s.totals.ess,s.tP)}</td></tr></tbody></table></div></div>`;
}
function exportMaterialCumul(){
  const cu=cumul('9999-12-31'),weld=weldingVisible(),rows=[[projectName()],['Cumuls saisis — '+fD(today())],[],['Front','Zone','Sous-tronçon','Matériau','DN','Prévu (ml)','Bardage (ml)',...(weld?['Soudure PEHD (ml)']:[]),'Fouille (ml)','Pose (ml)','Essais (ml)']];
  for(const l of LOC)for(const z of l.zones)for(const [dn,p] of Object.entries(z.dn)){
    const d=cu[l.id]?.zones?.[z.zid]?.dn?.[dn]||{};
    rows.push([l.nm,l.z,z.nm,zoneMaterial(z),+dn,p,+d.bar||0,...(weld?[weldedZone(z)?(+d.s||0):'N/A']:[]),+d.f||0,+d.r||0,+d.ess||0]);
  }
  const summary=[['Indice physique — '+projectName()],['Poids PEHD conservés ; poids de soudure transféré à la pose PVC. Regards comptés une seule fois.'],[],['Périmètre','Prévu (ml)','Pose retenue (ml)','PEHD prévu (ml)','Soudure PEHD retenue (ml)','Regards prévus','Avancement GC','Indice physique']];
  const groups=[...LOC.map(l=>[l.nm,[l]]),...ZN.map(z=>['Zone '+z,LOC.filter(l=>l.z===z)]),['Projet',LOC]];
  for(const [name,locs] of groups){const s=materialSummary(locs,cu);summary.push([name,s.tP,s.totals.rem,s.pehdPlanned,s.pehdPlanned?s.totals.soud:'N/A',s.gcTotal,s.gcTotal?s.rates.gc/100:'N/A',s.index/100]);}
  const wb=XLSX.utils.book_new(),ws=XLSX.utils.aoa_to_sheet(rows),ss=XLSX.utils.aoa_to_sheet(summary);
  ws['!cols']=rows[3].map((_,i)=>({wch:i<4?24:18}));ss['!cols']=summary[3].map((_,i)=>({wch:i===0?28:22}));
  for(let r=4;r<summary.length;r++)for(const c of [6,7]){const cell=ss[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z='0.00%';}
  XLSX.utils.book_append_sheet(wb,ws,'Cumuls par matériau');XLSX.utils.book_append_sheet(wb,ss,'Indice physique');
  XLSX.writeFile(wb,'Cumul_'+projectIdSlug(projectShortName())+'_'+today()+'.xlsx');
}
