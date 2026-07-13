// ─── Panel de tramas CSJB — lógica (fork de app.js para la versión CSJB) ─────
if (!window.__csjbLoaded) {
window.__csjbLoaded = true;
const ESTADOS = [
  '— sin estado —','En trama','En colocaciones','Correo','Ticket',
  'Dif. precio','EV','N/C','Compañía cerrada','Movimiento','Anulado',
  'En espera de Registro de Factura'
];
const ESTADOS_ED = ESTADOS.filter(e => e !== '— sin estado —');

const BADGE_MAP = {
  'En trama':                       'badge-pend',
  'En colocaciones':                'badge-cobr',
  'Correo':                         'badge-obs',
  'Ticket':                         'badge-tkt',
  'Dif. precio':                    'badge-dev',
  'EV':                             'badge-ev',
  'N/C':                            'badge-nc',
  'Compañía cerrada':               'badge-cc',
  'Movimiento':                     'badge-mov',
  'Anulado':                        'badge-anu',
  '— sin estado —':                 'badge-sin',
  'En espera de Registro de Factura':'badge-erf',
};
const DOT_MAP = {
  'En trama':                       '#6b5bd2',
  'En colocaciones':                '#2aa15c',
  'Correo':                         '#e87f17',
  'Ticket':                         '#9c4dcc',
  'Dif. precio':                    '#d84a63',
  'EV':                             '#c39a12',
  'N/C':                            '#d0559f',
  'Compañía cerrada':               '#5b8aa8',
  'Movimiento':                     '#199f92',
  'Anulado':                        '#8a93a6',
  '— sin estado —':                 '#b9aec4',
  'En espera de Registro de Factura':'#2aa8c8',
};

const LS_EST   = 'tramas_estados_v6';
const LS_HIST  = 'tramas_hist_v6';
const LS_ASIGN = 'tramas_asign_v6';
const LS_EXSL  = 'tramas_exsl_v6';
const LS_NOTAS = 'tramas_notas_v1';

function lsGet(k, def) {
  try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch(e) { return def; }
}
function lsSet(k, v) {
  localStorage.setItem(k, JSON.stringify(v));
  // guardar en Supabase en background
  if (typeof sbGuardar === 'function') {
    sbGuardar(k, v);
  }
}

let estados      = lsGet(LS_EST, {});
let historial    = lsGet(LS_HIST, {});
let asignaciones = lsGet(LS_ASIGN, {});
let extraSL      = lsGet(LS_EXSL, []);
let notas        = lsGet(LS_NOTAS, []);

let lotes           = [];
let facturasRaw     = [];
let facturasSinLote = [];
let montoCsvFinal   = null;
let currentKey      = null;
let currentEsSL     = false;
let modalAsignarKey = null;
let modalEditarKey  = null;
let modalEliminarKey= null;
let hlKey           = null;
let seleccionadas   = new Set();
let filComps        = new Set();
let filAsegs        = new Set();
const MS_NONE='\u0000__none__';

const badge     = est => { const e = ESTADOS.includes(est) ? est : '— sin estado —'; return `<span class="badge ${BADGE_MAP[e]}">${e}</span>`; };
const estadoV   = est => ESTADOS.includes(est) ? est : '— sin estado —';
const cL        = (l,s) => `${l}_${s}`;
const cSL       = (s,n) => `SL_${s}_${n}`;
const todayISO  = ()    => new Date().toISOString().split('T')[0];
const todayFmt  = ()    => new Date().toLocaleDateString('es-PE');
const fmtMonto  = n     => n > 0 ? 'S/ ' + n.toLocaleString('es-PE', {minimumFractionDigits:2, maximumFractionDigits:2}) : '—';
const parseMonto= s     => parseFloat(String(s||'0').replace(/[^0-9.,]/g,'').replace(',','.')) || 0;
const extraAnio = f     => { if(!f||f==='—') return null; const p=f.split('/'); return p.length===3?p[2]:null; };
const fechaTS   = f     => { if(!f||f==='—') return -Infinity; const p=f.split('/'); if(p.length!==3) return -Infinity; const d=new Date(+p[2],+p[1]-1,+p[0]); return isNaN(d)?-Infinity:d.getTime(); };

function fmtFecha(val){
  if(!val||val==='') return '—';
  if(val instanceof Date&&!isNaN(val)) return val.toLocaleDateString('es-PE');
  if(typeof val==='number') return new Date(Math.round((val-25569)*86400*1000)).toLocaleDateString('es-PE');
  const s=String(val).trim(), soloFecha=s.split(' ')[0], p=soloFecha.split(/[\/\-]/);
  if(p.length>=3){
    let a=p[0],b=p[1],yyyy=p[2].length===2?'20'+p[2]:p[2];
    if(/^\d+$/.test(a)&&/^\d+$/.test(b)&&/^\d+$/.test(yyyy)){
      let mm,dd;
      if(parseInt(a,10)>12){dd=a;mm=b;} else {mm=a;dd=b;}
      return `${dd.padStart(2,'0')}/${mm.padStart(2,'0')}/${yyyy}`;
    }
  }
  return s;
}

function showToast(id,mid,msg,tipo='ok'){
  const t=document.getElementById(id);
  document.getElementById(mid).textContent=msg;
  t.className=`toast toast-${tipo}`;
  t.style.display='flex';
  setTimeout(()=>t.style.display='none',3500);
}

function updateStorageInfo(){
  const b=[LS_EST,LS_HIST,LS_ASIGN,LS_EXSL,LS_NOTAS].reduce((a,k)=>a+(localStorage.getItem(k)||'').length,0);
  document.getElementById('storage-info').textContent=`${(b/1024).toFixed(1)} KB · ${Object.keys(estados).length} estados`;
}

function poblarSelectsEstados(){
  document.getElementById('fil-est').innerHTML='<option value="">Todos los estados</option>'+ESTADOS.map(e=>`<option>${e}</option>`).join('');
  document.getElementById('det-estado').innerHTML=ESTADOS_ED.map(e=>`<option>${e}</option>`).join('');
}

function importarArchivo(input){
  const file=(input.files||[])[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>procesarArchivo(e.target.result,file.name);
  reader.readAsArrayBuffer(file);
  input.value='';
}
function onDrop(e){
  e.preventDefault();
  document.getElementById('drop-zone').classList.remove('drag');
  const file=e.dataTransfer.files[0]; if(!file) return;
  const reader=new FileReader();
  reader.onload=ev=>procesarArchivo(ev.target.result,file.name);
  reader.readAsArrayBuffer(file);
}

function parsearCSV(texto){
  const lineas=texto.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n').filter(l=>l.trim());
  if(lineas.length<2) return [];
  const enc=lineas[0].replace(/^\uFEFF/,'').split(';').map(h=>h.trim().toUpperCase());
  const rows=[];
  for(let i=1;i<lineas.length;i++){
    const vals=lineas[i].split(';');
    if(vals.every(v=>!v.trim())) continue;
    const obj={}; enc.forEach((h,idx)=>{obj[h]=(vals[idx]||'').trim();}); rows.push(obj);
  }
  return rows;
}

function procesarArchivo(buffer,nombre){
  try {
    const nombreL=nombre.toLowerCase();
    const esExcel=nombreL.endsWith('.xlsx')||nombreL.endsWith('.xls');
    const esCsvPuntoComa=!esExcel&&(()=>{
      const csvText=new TextDecoder('utf-8').decode(new Uint8Array(buffer).slice(0,2000));
      return csvText.includes(';')&&!csvText.includes('\t');
    })();

    let rows;
    if(!esExcel&&esCsvPuntoComa){
      rows=parsearCSV(new TextDecoder('utf-8').decode(new Uint8Array(buffer)));
    } else {
      const wb=XLSX.read(buffer,{type:'array',cellDates:true,raw:false});
      const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false}).map(r=>{
        const o={}; Object.keys(r).forEach(k=>{o[String(k).replace(/^\uFEFF/,'').trim().toUpperCase()]=r[k];}); return o;
      });
    }
    if(!rows||!rows.length){showToast('toast-main','toast-msg','El archivo está vacío.','err');return;}

    const _colsDetect=rows.length?Object.keys(rows[0]).map(k=>String(k).replace(/^\uFEFF/,'').trim().toUpperCase()):[];
    const _colMonto=_colsDetect.includes('MTONETO')?'MTONETO':'MTO_TOTGRALPAMB';

    let montoFinal=null;
    const rowsDatos=[];
    rows.forEach(r=>{
      const lote=String(r.LOTE||'').trim(),num=String(r.NUM_FACTURAEST||'').trim(),mto=parseMonto(r[_colMonto]);
      if(!lote&&!num&&mto>0){montoFinal=mto;}
      else if(num||lote) rowsDatos.push(r);
    });
    montoCsvFinal=montoFinal;

    if(!rowsDatos.length){showToast('toast-main','toast-msg','Sin filas de datos válidas.','err');return;}

    const colsNorm=Object.keys(rowsDatos[0]).map(k=>String(k).replace(/^\uFEFF/,'').trim().toUpperCase());
    const req=['LOTE','SER_FACTURAEST','NUM_FACTURAEST'];
    const falt=req.filter(c=>!colsNorm.includes(c));
    const hayMonto=colsNorm.includes('MTONETO')||colsNorm.includes('MTO_TOTGRALPAMB');
    if(falt.length||!hayMonto){
      const msg=falt.length?`Faltan columnas: ${falt.join(', ')}`:'Falta columna de monto';
      showToast('toast-main','toast-msg',msg+`. Detectadas: ${colsNorm.join(', ')}`,'err');return;
    }

    const todas=rowsDatos.map(r=>({
      lote:     String(r.LOTE||'').trim(),
      serie:    String(r.SER_FACTURAEST||'').trim(),
      num:      String(r.NUM_FACTURAEST||'').trim(),
      monto:    parseMonto(r[_colMonto]),
      aseg:     String(r.ASEGURADORA||r.COMPANIA||'— sin aseguradora —').trim()||'— sin aseguradora —',
      compania: String(r.COMPANIA||'').trim(),
      esSoat:   String(r.COMPANIA||'').trim().toUpperCase()==='SOAT',
      fechaAt:  fmtFecha(r.FEC_ATENCION),
      fechaEst: fmtFecha(r.FEC_ESTADO),
    }));

    facturasRaw=todas.filter(f=>f.lote&&f.num);
    const slCsv=todas.filter(f=>!f.lote&&f.num);

    const mapa={};
    facturasRaw.forEach(f=>{
      const k=cL(f.lote,f.serie);
      if(!mapa[k]) mapa[k]={id:f.lote,serie:f.serie,key:k,aseg:f.aseg,monto:0,facturas:0,fechaAt:f.fechaAt,fechaEstCsv:f.fechaEst,soatCount:0};
      mapa[k].monto+=f.monto;mapa[k].facturas+=1;
      if(f.esSoat) mapa[k].soatCount+=1;
    });
    lotes=Object.values(mapa);
    lotes.forEach(l=>{l.esSoat=l.soatCount>0;});
    lotes.forEach(l=>{if(!estados[l.key]) estados[l.key]={estado:'— sin estado —',fechaEst:l.fechaEstCsv||'—'};});

    const slMap={};
    slCsv.forEach(f=>{slMap[cSL(f.serie,f.num)]=f;});
    const yaConLote=new Set(facturasRaw.map(f=>`${f.serie}_${f.num}`));
    extraSL=extraSL.filter(f=>!yaConLote.has(`${f.serie}_${f.num}`));
    extraSL.forEach(f=>{const k=cSL(f.serie,f.num);if(!slMap[k]) slMap[k]=f;});
    lsSet(LS_EXSL,extraSL);
    facturasSinLote=Object.values(slMap);
    facturasSinLote.forEach(f=>{const k=cSL(f.serie,f.num);if(!estados[k]) estados[k]={estado:'— sin estado —',fechaEst:f.fechaEst||'—'};});

    Object.keys(asignaciones).forEach(k=>{
      const sp=k.replace('SL_','').split('_');
      if(yaConLote.has(`${sp[0]}_${sp[1]}`)) delete asignaciones[k];
    });
    lsSet(LS_ASIGN,asignaciones);
    lsSet(LS_EST,estados);
    seleccionadas.clear();

    document.getElementById('topbar-fecha').textContent=`${nombre} · ${lotes.length} lotes · ${facturasRaw.length} facts · ${facturasSinLote.length} sin lote`;
    document.getElementById('btn-export').disabled=false;

    mostrarContenido();validarMonto();renderTabla();renderMetrics();updateStorageInfo();
    const recup=lotes.filter(l=>estados[l.key]?.estado!=='— sin estado —').length;
    showToast('toast-main','toast-msg',`${lotes.length} lotes · ${facturasSinLote.length} sin lote · ${recup} estados recuperados`,'ok');
    // guardar excel en supabase si es tramador
    if (typeof sbGuardarExcel === 'function' && window.currentUser?.rol === 'tramador') {
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      sbGuardarExcel(nombre, b64);
    }
  } catch(err){
    console.error(err);
    showToast('toast-main','toast-msg','Error al leer el archivo: '+err.message,'err');
  }
}

function validarMonto(){
  const el=document.getElementById('monto-check');
  if(!montoCsvFinal){el.style.display='none';return;}
  const suma=[...facturasRaw,...facturasSinLote].reduce((a,f)=>a+f.monto,0);
  const diff=Math.abs(suma-montoCsvFinal);
  el.style.display='block';
  if(diff<0.05){
    el.innerHTML=`<div class="monto-ok"><i class="ti ti-circle-check" style="font-size:14px"></i> Monto validado — total calculado coincide con el CSV (${fmtMonto(montoCsvFinal)})</div>`;
  } else {
    el.innerHTML=`<div class="monto-warn"><i class="ti ti-alert-triangle" style="font-size:15px;flex-shrink:0;margin-top:1px"></i><div><strong>Diferencia de monto detectada.</strong> CSV indica ${fmtMonto(montoCsvFinal)}, suma calculada: ${fmtMonto(suma)} (diferencia: S/ ${diff.toLocaleString('es-PE',{minimumFractionDigits:2})}). Verifica si hay facturas excluidas.</div></div>`;
  }
}

let vistaActual='lotes';
function aplicarVisibilidadVista(){
  const hay=lotes.length||facturasSinLote.length;
  const me=document.getElementById('main-empty');
  const mc=document.getElementById('main-content');
  if(!me||!mc) return;
  if(vistaActual==='notas'){me.style.display='none';mc.style.display='none';}
  else if(vistaActual==='analisis'){me.style.display='none';mc.style.display='block';}
  else {me.style.display=hay?'none':'block';mc.style.display=hay?'block':'none';}
}
function mostrarContenido(){
  aplicarVisibilidadVista();
  poblarFiltros();
}

function msLabel(pref,selSet,allTxt,unidad){
  const lab=document.getElementById(pref+'-label');const btn=document.getElementById(pref+'-btn');
  if(!lab||!btn) return;
  const real=[...selSet].filter(v=>v!==MS_NONE);
  if(!selSet.size){lab.textContent=allTxt;btn.classList.remove('has-sel');}
  else if(!real.length){lab.textContent='Ninguna seleccionada';btn.classList.add('has-sel');}
  else if(real.length===1){const v=real[0];lab.textContent=v.length>20?v.slice(0,18)+'…':v;btn.classList.add('has-sel');}
  else{lab.textContent=real.length+' '+unidad;btn.classList.add('has-sel');}
}

function buildMS(pref,valores,selSet,allTxt,unidad){
  const panel=document.getElementById(pref+'-panel');if(!panel) return;
  [...selSet].forEach(c=>{if(c!==MS_NONE&&!valores.includes(c)) selSet.delete(c);});
  const isAll=!selSet.size;
  panel.innerHTML=
    '<div class="ms-search"><i class="ti ti-search"></i><input type="text" placeholder="Buscar…"></div>'
    +'<label class="ms-item ms-all"><input type="checkbox" class="ms-all-chk"'+(isAll?' checked':'')+'><span>(Seleccionar todo)</span></label>'
    +'<div class="ms-items">'
    +(valores.length?valores.map(c=>'<label class="ms-item" data-txt="'+escHtml(c.toLowerCase())+'"><input type="checkbox" value="'+escHtml(c)+'"'+((isAll||selSet.has(c))?' checked':'')+'><span title="'+escHtml(c)+'">'+escHtml(c)+'</span></label>').join(''):'<div class="ms-empty">Sin datos</div>')
    +'</div>';
  const allChk=panel.querySelector('.ms-all-chk');
  const itemChks=[...panel.querySelectorAll('.ms-items input[type=checkbox]')];
  itemChks.forEach(ch=>ch.addEventListener('change',()=>{
    selSet.delete(MS_NONE);
    if(!selSet.size&&!ch.checked){valores.forEach(v=>selSet.add(v));}
    if(ch.checked) selSet.add(ch.value); else selSet.delete(ch.value);
    if(selSet.size===valores.length){selSet.clear();itemChks.forEach(c=>c.checked=true);}
    if(!selSet.size&&!ch.checked){selSet.add(MS_NONE);itemChks.forEach(c=>c.checked=false);}
    allChk.checked=!selSet.size;
    msLabel(pref,selSet,allTxt,unidad);renderTabla();renderMetrics();
  }));
  allChk.addEventListener('change',()=>{
    selSet.clear();
    if(allChk.checked){itemChks.forEach(c=>c.checked=true);}
    else{selSet.add(MS_NONE);itemChks.forEach(c=>c.checked=false);}
    msLabel(pref,selSet,allTxt,unidad);renderTabla();renderMetrics();
  });
  const si=panel.querySelector('.ms-search input');
  si.addEventListener('input',()=>{
    const q=si.value.trim().toLowerCase();
    panel.querySelectorAll('.ms-items .ms-item').forEach(it=>{it.style.display=!q||(it.dataset.txt||'').includes(q)?'flex':'none';});
  });
  msLabel(pref,selSet,allTxt,unidad);
}

function poblarFiltros(){
  const asegs=[...new Set([...lotes.map(l=>l.aseg),...facturasSinLote.map(f=>f.aseg)])].filter(Boolean).sort();
  buildMS('ms-aseg',asegs,filAsegs,'Todas las aseguradoras','aseguradoras');

  const comps=[...new Set([...facturasRaw,...facturasSinLote].map(f=>f.compania))].filter(Boolean).sort();
  buildMS('ms-comp',comps,filComps,'Todas las compañías','compañías');

  const anios=[...new Set([...facturasRaw,...facturasSinLote].map(f=>extraAnio(f.fechaAt)))].filter(Boolean).sort((a,b)=>b-a);
  const selY=document.getElementById('fil-anio');const vY=selY.value;
  selY.innerHTML='<option value="">Todos los años</option>'+anios.map(a=>`<option${a===vY?' selected':''}>${a}</option>`).join('');
}

function __fAseg(x){return !filAsegs.size||filAsegs.has(x.aseg);}

function renderMetrics(){
  const {filtL,filtSL}=filtrarDatos();
  const keysL=new Set(filtL.map(l=>l.key));
  const factsF=facturasRaw.filter(f=>keysL.has(cL(f.lote,f.serie)));
  const total=filtL.length,nfacts=factsF.length,nSL=filtSL.length;
  const sinEst=filtL.filter(l=>estadoV(estados[l.key]?.estado)==='— sin estado —').length;
  const colocs=filtL.filter(l=>estados[l.key]?.estado==='En colocaciones').length;
  const montoT=[...facturasRaw,...facturasSinLote].reduce((a,f)=>a+f.monto,0);
  const montoSel=filtL.reduce((a,l)=>a+l.monto,0)+filtSL.reduce((a,f)=>a+f.monto,0);
  const filEst=document.getElementById('fil-est')?.value||'';
  const montoEstado=montoSel;
  const labelEstado=filEst?filEst:(hayFiltroActivo()?'Monto seleccionado':'Monto total');

  document.getElementById('metrics-grid').innerHTML=`
    <div class="metric"><div class="metric-ico mi-purple"><i class="ti ti-packages"></i></div><div><div class="metric-label">Lotes activos</div><div class="metric-val metric-accent">${total}</div></div></div>
    <div class="metric"><div class="metric-ico mi-slate"><i class="ti ti-receipt-2"></i></div><div><div class="metric-label">Facts. con lote</div><div class="metric-val">${nfacts}</div></div></div>
    <div class="metric"><div class="metric-ico mi-orange"><i class="ti ti-file-unknown"></i></div><div><div class="metric-label">Sin lote</div><div class="metric-val metric-warn">${nSL}</div></div></div>
    <div class="metric"><div class="metric-ico mi-orange"><i class="ti ti-help-circle"></i></div><div><div class="metric-label">Sin estado</div><div class="metric-val metric-warn">${sinEst}</div></div></div>
    <div class="metric"><div class="metric-ico mi-green"><i class="ti ti-circle-check"></i></div><div><div class="metric-label">En colocaciones</div><div class="metric-val metric-ok">${colocs}</div></div></div>
    <div class="metric"><div class="metric-ico mi-purple"><i class="ti ti-cash"></i></div><div><div class="metric-label">Monto total</div><div class="metric-val small">${fmtMonto(montoT)}</div></div></div>
    <div class="metric"><div class="metric-ico mi-purple"><i class="ti ti-filter-dollar"></i></div><div><div class="metric-label">${labelEstado}</div><div class="metric-val small metric-accent">${fmtMonto(montoEstado)}</div></div></div>`;

  renderDistChart();
  renderAnalisis();
}

function renderDistChart(){
  const cont=document.getElementById('dist-chart');if(!cont) return;
  const conteo={};ESTADOS.forEach(e=>conteo[e]=0);
  const {filtL,filtSL}=filtrarDatos();
  filtL.forEach(l=>{conteo[estadoV(estados[l.key]?.estado)]++;});
  filtSL.forEach(f=>{const k=cSL(f.serie,f.num);conteo[estadoV(estados[k]?.estado)]++;});
  const totalCasos=filtL.length+filtSL.length;
  if(!totalCasos){cont.innerHTML='';return;}
  const segs=ESTADOS.filter(e=>conteo[e]>0);
  const barHtml=segs.map(e=>{
    const pct=(conteo[e]/totalCasos*100).toFixed(2);
    return `<div class="dist-seg" style="width:${pct}%;background:${DOT_MAP[e]}" title="${e}: ${conteo[e]}"></div>`;
  }).join('');
  const legendHtml=segs.map(e=>{
    const pct=Math.round(conteo[e]/totalCasos*100);
    return `<div class="dist-item"><span class="dist-dot" style="background:${DOT_MAP[e]}"></span><strong>${conteo[e]}</strong>&nbsp;${e}&nbsp;(${pct}%)</div>`;
  }).join('');
  cont.innerHTML=`<div class="dist-bar">${barHtml}</div><div class="dist-legend">${legendHtml}</div>`;
}

function onSearch(){
  const q=document.getElementById('search').value.trim();hlKey=null;
  const banner=document.getElementById('factura-banner');
  if(q&&/^\d{4,}$/.test(q)){
    const f=facturasRaw.find(x=>x.num===q);
    if(f){hlKey=cL(f.lote,f.serie);document.getElementById('factura-banner-txt').textContent=`Factura ${q} → Lote ${f.lote} (serie ${f.serie}). Fila resaltada.`;banner.style.display='flex';}
    else{const sl=facturasSinLote.find(x=>x.num===q);
      if(sl){hlKey=cSL(sl.serie,sl.num);document.getElementById('factura-banner-txt').textContent=`Factura ${q} (serie ${sl.serie}) sin lote — ver sección inferior.`;banner.style.display='flex';}
      else banner.style.display='none';
    }
  } else banner.style.display='none';
  renderTabla();renderMetrics();
}
function limpiarBusqueda(){document.getElementById('search').value='';hlKey=null;document.getElementById('factura-banner').style.display='none';renderTabla();renderMetrics();}
function limpiarFiltros(){
  document.getElementById('search').value='';
  filAsegs.clear();filComps.clear();
  poblarFiltros();
  document.getElementById('fil-anio').value='';
  document.getElementById('fil-est').value='';
  document.getElementById('orden-sel').value='';
  hlKey=null;document.getElementById('factura-banner').style.display='none';
  renderTabla();renderMetrics();
}

function filtrarDatos(){
  const q=(document.getElementById('search')?.value||'').toLowerCase();
  const anio=document.getElementById('fil-anio')?.value||'';
  const est=document.getElementById('fil-est')?.value||'';

  const filtL=lotes.filter(l=>{
    const e=estadoV(estados[l.key]?.estado);
    if(filAsegs.size&&!filAsegs.has(l.aseg)) return false;
    if(est&&e!==est) return false;
    if(filComps.size){if(!facturasRaw.some(f=>f.lote===l.id&&f.serie===l.serie&&filComps.has(f.compania))) return false;}
    if(anio){if(!facturasRaw.some(f=>f.lote===l.id&&f.serie===l.serie&&extraAnio(f.fechaAt)===anio)) return false;}
    if(q){if(!l.id.toLowerCase().includes(q)&&!l.aseg.toLowerCase().includes(q)&&
              !facturasRaw.some(f=>f.lote===l.id&&f.serie===l.serie&&(f.num.toLowerCase().includes(q)||f.compania.toLowerCase().includes(q)))) return false;}
    return true;
  });

  const filtSL=facturasSinLote.filter(f=>{
    const k=cSL(f.serie,f.num);const e=estadoV(estados[k]?.estado);
    if(filAsegs.size&&!filAsegs.has(f.aseg)) return false;
    if(est&&e!==est) return false;
    if(filComps.size&&!filComps.has(f.compania)) return false;
    if(anio&&extraAnio(f.fechaAt)!==anio) return false;
    if(q&&!f.num.toLowerCase().includes(q)&&!f.aseg.toLowerCase().includes(q)&&!f.compania.toLowerCase().includes(q)) return false;
    return true;
  });

  return {filtL,filtSL};
}

function hayFiltroActivo(){
  return !!(filAsegs.size||filComps.size||(document.getElementById('fil-anio')?.value||'')||(document.getElementById('fil-est')?.value||'')||(document.getElementById('search')?.value||'').trim());
}

function renderTabla(){
  const {filtL,filtSL}=filtrarDatos();

  const orden=document.getElementById('orden-sel')?.value||'';
  if(orden){
    const [campo,dir]=orden.split('_');const mult=dir==='asc'?1:-1;
    const valL=l=>campo==='monto'?l.monto:campo==='fecAt'?fechaTS(l.fechaAt):fechaTS(l.fechaEstCsv);
    const valF=f=>campo==='monto'?f.monto:campo==='fecAt'?fechaTS(f.fechaAt):fechaTS(f.fechaEst);
    filtL.sort((a,b)=>(valL(a)-valL(b))*mult);
    filtSL.sort((a,b)=>(valF(a)-valF(b))*mult);
  }

  const tbody=document.getElementById('main-tbody');
  if(!filtL.length&&!filtSL.length){
    tbody.innerHTML=`<tr><td colspan="9" class="empty-cell"><i class="ti ti-search-off"></i>Sin resultados</td></tr>`;
    return;
  }

  let html='';
  filtL.forEach((l,i)=>{
    const ei=estados[l.key]||{estado:'— sin estado —',fechaEst:l.fechaEstCsv||'—'};
    const ea=estadoV(ei.estado);
    const delay=Math.min(i,25)*0.025;
    html+=`<tr${hlKey===l.key?' class="highlight-row"':''} style="animation-delay:${delay}s">
      <td></td>
      <td><span class="lote-chip">${l.id}</span></td>
      <td class="cell-serie">${l.serie}</td>
      <td class="cell-facts">${l.facturas}</td>
      <td class="cell-aseg" title="${l.aseg}">${l.aseg.length>36?l.aseg.slice(0,34)+'…':l.aseg}${l.esSoat?' <span class="badge badge-soat">SOAT</span>':''}</td>
      <td class="cell-monto">${fmtMonto(l.monto)}</td>
      <td class="cell-fecha">${l.fechaEstCsv||'—'}</td>
      <td>
        <div class="est-cell">
          <span class="est-dot" style="background:${DOT_MAP[ea]||'#999'}"></span>
          <select class="est-sel" onchange="cambiarEstado('${l.key}',this.value,false,${i})">
            ${ESTADOS.map(o=>`<option${o===ea?' selected':''}>${o}</option>`).join('')}
          </select>
          <span class="saved-flash" id="sf-${i}"><i class="ti ti-check"></i></span>
        </div>
      </td>
      <td>
        <div class="row-actions">
          <button class="btn btn-sm btn-icon" onclick="showDetail('${l.key}',false)" title="Ver detalle"><i class="ti ti-eye"></i></button>
          <button class="btn btn-sm btn-icon" onclick="abrirEditar('${l.key}')" title="Editar lote"><i class="ti ti-edit"></i></button>
          <button class="btn btn-sm btn-icon btn-danger" onclick="abrirEliminar('${l.key}')" title="Eliminar"><i class="ti ti-trash"></i></button>
        </div>
      </td>
    </tr>`;
  });

  if(filtSL.length){
    html+=`<tr><td colspan="9" class="cell-flat"><div class="section-divider"><i class="ti ti-file-unknown"></i>Facturas sin lote<span class="count-pill">${filtSL.length}</span></div></td></tr>`;
    if(seleccionadas.size>0){
      html+=`<tr><td colspan="9" class="cell-flat">
        <div class="seleccion-bar">
          <i class="ti ti-checkbox"></i>
          <span>${seleccionadas.size} factura${seleccionadas.size!==1?'s':''} seleccionada${seleccionadas.size!==1?'s':''}</span>
          <button class="btn btn-sm btn-accent sel-unir" onclick="abrirUnirLote()"><i class="ti ti-stack-2"></i> Unir a lote</button>
          <button class="btn btn-sm" onclick="limpiarSeleccion()"><i class="ti ti-x"></i> Cancelar</button>
        </div>
      </td></tr>`;
    }
    filtSL.forEach((f,i)=>{
      const k=cSL(f.serie,f.num);
      const ei=estados[k]||{estado:'— sin estado —',fechaEst:f.fechaEst||'—'};
      const ea=estadoV(ei.estado);
      const la=asignaciones[k];
      const idx=filtL.length+i;
      const delay=Math.min(filtL.length+i,25)*0.025;
      html+=`<tr style="animation-delay:${delay}s"${hlKey===k?' class="highlight-row"':''}>
        <td><input type="checkbox" class="row-chk" data-key="${k}" ${seleccionadas.has(k)?'checked':''} onchange="toggleSeleccion('${k}',this.checked)"></td>
        <td>${la?`<span class="lote-asig"><i class="ti ti-link"></i> ${la}</span>`:`<span class="lote-vacio"><i class="ti ti-minus"></i> Sin lote</span>`}</td>
        <td class="cell-serie">${f.serie}</td>
        <td class="cell-num">${f.num}</td>
        <td class="cell-aseg" title="${f.aseg}">${f.aseg.length>36?f.aseg.slice(0,34)+'…':f.aseg}${f.esSoat?' <span class="badge badge-soat">SOAT</span>':''}</td>
        <td class="cell-monto">${fmtMonto(f.monto)}</td>
        <td class="cell-fecha">${f.fechaEst||'—'}</td>
        <td>
          <div class="est-cell">
            <span class="est-dot" style="background:${DOT_MAP[ea]||'#999'}"></span>
            <select class="est-sel" onchange="cambiarEstado('${k}',this.value,true,${idx})">
              ${ESTADOS.map(o=>`<option${o===ea?' selected':''}>${o}</option>`).join('')}
            </select>
            <span class="saved-flash" id="sf-${idx}"><i class="ti ti-check"></i></span>
          </div>
        </td>
        <td>
          <div class="row-actions">
            <button class="btn btn-sm btn-icon" onclick="showDetail('${k}',true)" title="Ver detalle"><i class="ti ti-eye"></i></button>
            <button class="btn btn-sm btn-icon btn-warn" onclick="abrirAsignar('${k}','${f.num}','${f.serie}')" title="Asignar a lote"><i class="ti ti-link"></i></button>
          </div>
        </td>
      </tr>`;
    });
  }

  tbody.innerHTML=html;
}

function cambiarEstado(key,val,esSL,idx){
  if(!estados[key]) estados[key]={estado:'— sin estado —',fechaEst:'—'};
  estados[key].estado=val;lsSet(LS_EST,estados);
  if(val!=='— sin estado —'){
    if(!historial[key]) historial[key]=[];
    historial[key].unshift({estado:val,fecha:todayFmt(),nota:''});
    lsSet(LS_HIST,historial);
  }
  renderMetrics();renderTabla();updateStorageInfo();
  const sf=document.getElementById('sf-'+idx);
  if(sf){sf.style.display='inline-flex';setTimeout(()=>sf.style.display='none',1800);}
}

function showDetail(key,esSL){
  currentKey=key;currentEsSL=esSL;
  let titulo,sub,monto,fechaAt,nfacts,aseg;
  if(!esSL){
    const l=lotes.find(x=>x.key===key);if(!l) return;
    titulo=`Lote ${l.id}`;sub=`Serie ${l.serie} · ${l.aseg} · ${l.facturas} facturas${l.esSoat?' · <span class="badge badge-soat">SOAT</span>':''}`;
    monto=fmtMonto(l.monto);fechaAt=l.fechaAt;nfacts=l.facturas;aseg=l.aseg;
    document.getElementById('det-asign-card').style.display='none';
  } else {
    const sp=key.replace('SL_','').split('_');const f=facturasSinLote.find(x=>x.serie===sp[0]&&x.num===sp[1]);if(!f) return;
    const la=asignaciones[key];
    titulo=`Factura ${f.num}`;sub=`Serie ${f.serie} · ${f.aseg}${la?' · Asignada a lote '+la:''}${f.esSoat?' · <span class="badge badge-soat">SOAT</span>':''}`;
    monto=fmtMonto(f.monto);fechaAt=f.fechaAt;nfacts=1;aseg=f.aseg;
    document.getElementById('det-asign-card').style.display='block';
    document.getElementById('det-asign-val').textContent=la||'— sin asignar —';
  }
  const ei=estados[key]||{estado:'— sin estado —',fechaEst:'—'};
  document.getElementById('det-titulo').textContent=titulo;
  document.getElementById('det-subtitulo').innerHTML=sub;
  document.getElementById('det-monto').textContent=monto;
  document.getElementById('det-fecha-at').textContent=fechaAt;
  document.getElementById('det-nfacts').textContent=nfacts;
  document.getElementById('det-aseg').textContent=aseg;
  document.getElementById('det-estado').value=estadoV(ei.estado)!=='— sin estado —'?estadoV(ei.estado):ESTADOS_ED[0];
  document.getElementById('det-fecha').value=todayISO();
  document.getElementById('det-nota').value='';
  document.getElementById('toast-det').style.display='none';
  renderHistorial(key);renderFacturasDetalle(key,esSL);
  document.getElementById('page-main').classList.remove('active');
  document.getElementById('page-detail').classList.add('active');
  window.scrollTo(0,0);
}

function renderHistorial(key){
  const hist=historial[key]||[];
  const el=document.getElementById('historial-list');
  if(!hist.length){el.innerHTML='<div class="empty-hist">Sin cambios registrados aún.</div>';return;}
  el.innerHTML=hist.map(h=>`<div class="hist-item">
    <div class="hist-dot" style="background:${DOT_MAP[h.estado]||'#555'}"></div>
    <div class="hist-body">
      <div class="hist-line">${badge(h.estado)}<span class="hist-date">${h.fecha}</span></div>
      ${h.nota?`<div class="hist-nota">${h.nota}</div>`:''}
    </div></div>`).join('');
}

function renderFacturasDetalle(key,esSL){
  const tbody=document.getElementById('det-tbody');
  let facts;
  if(!esSL){const l=lotes.find(x=>x.key===key);facts=l?facturasRaw.filter(f=>f.lote===l.id&&f.serie===l.serie):[];}
  else{const sp=key.replace('SL_','').split('_');facts=facturasSinLote.filter(f=>f.serie===sp[0]&&f.num===sp[1]);}
  tbody.innerHTML=facts.map(f=>`<tr>
    <td class="cell-num">${f.num}</td>
    <td class="cell-serie">${f.serie}</td>
    <td>${f.compania||'—'}</td>
    <td class="cell-monto">${fmtMonto(f.monto)}</td>
    <td class="cell-fecha">${f.fechaAt}</td>
  </tr>`).join('');
}

function guardarEstadoDetalle(){
  const nuevoEst=document.getElementById('det-estado').value;
  const nota=document.getElementById('det-nota').value.trim();
  const fechaISO=document.getElementById('det-fecha').value;
  const fechaFmt=fechaISO?new Date(fechaISO+'T12:00:00').toLocaleDateString('es-PE'):todayFmt();
  if(!estados[currentKey]) estados[currentKey]={estado:'— sin estado —',fechaEst:'—'};
  estados[currentKey].estado=nuevoEst;lsSet(LS_EST,estados);
  if(!historial[currentKey]) historial[currentKey]=[];
  historial[currentKey].unshift({estado:nuevoEst,fecha:fechaFmt,nota});
  lsSet(LS_HIST,historial);
  document.getElementById('det-nota').value='';
  renderHistorial(currentKey);renderMetrics();updateStorageInfo();
  showToast('toast-det','toast-det-msg','Estado guardado','ok');
}

function showMain(){
  renderTabla();renderMetrics();
  document.getElementById('page-detail').classList.remove('active');
  document.getElementById('page-main').classList.add('active');
  window.scrollTo(0,0);
}

function abrirAsignar(key,num,serie){
  modalAsignarKey=key;
  document.getElementById('ma-num').textContent=num;
  document.getElementById('ma-serie').textContent=serie;
  document.getElementById('ma-lote').value=asignaciones[key]||'';
  document.getElementById('ma-fb').textContent='';
  document.getElementById('ma-btn-quitar').style.display=asignaciones[key]?'inline-flex':'none';
  abrirModal('modal-asignar');
  setTimeout(()=>document.getElementById('ma-lote').focus(),100);
}
function validarLoteAsignar(){
  const val=document.getElementById('ma-lote').value.trim();
  const fb=document.getElementById('ma-fb');if(!val){fb.textContent='';return;}
  const existe=lotes.some(l=>l.id===val);
  fb.innerHTML=existe?`<span class="fb-ok"><i class="ti ti-check"></i> Lote ${val} encontrado</span>`:`<span class="fb-warn"><i class="ti ti-alert-circle"></i> Lote no encontrado (puedes asignar igual)</span>`;
}
function confirmarAsignar(){
  const val=document.getElementById('ma-lote').value.trim();if(!modalAsignarKey) return;
  if(val){
    asignaciones[modalAsignarKey]=val;lsSet(LS_ASIGN,asignaciones);
    const sp=modalAsignarKey.replace('SL_','').split('_');
    const fIdx=facturasSinLote.findIndex(f=>f.serie===sp[0]&&f.num===sp[1]);
    if(fIdx>-1){
      const f={...facturasSinLote[fIdx],lote:val};
      facturasSinLote.splice(fIdx,1);facturasRaw.push(f);
      extraSL=extraSL.filter(x=>!(x.serie===f.serie&&x.num===f.num));lsSet(LS_EXSL,extraSL);
      const k=cL(val,f.serie);const lExist=lotes.find(l=>l.key===k);
      if(lExist){lExist.monto+=f.monto;lExist.facturas+=1;lExist.soatCount=(lExist.soatCount||0)+(f.esSoat?1:0);lExist.esSoat=lExist.soatCount>0;}
      else{const nl={id:val,serie:f.serie,key:k,aseg:f.aseg,monto:f.monto,facturas:1,fechaAt:f.fechaAt,fechaEstCsv:f.fechaEst,soatCount:f.esSoat?1:0,esSoat:f.esSoat};
        lotes.push(nl);if(!estados[k]) estados[k]={estado:'— sin estado —',fechaEst:f.fechaEst||'—'};lsSet(LS_EST,estados);}
      poblarFiltros();
    }
    showToast('toast-main','toast-msg',`Factura movida al lote ${val}`,'ok');
  } else {
    delete asignaciones[modalAsignarKey];lsSet(LS_ASIGN,asignaciones);
    showToast('toast-main','toast-msg','Asignación eliminada','ok');
  }
  cerrarModal('modal-asignar');renderTabla();renderMetrics();
}
function quitarAsignacion(){
  if(!modalAsignarKey) return;
  delete asignaciones[modalAsignarKey];lsSet(LS_ASIGN,asignaciones);
  cerrarModal('modal-asignar');renderTabla();showToast('toast-main','toast-msg','Asignación eliminada','ok');
}

function toggleSeleccion(key,checked){if(checked) seleccionadas.add(key);else seleccionadas.delete(key);renderTabla();}
function limpiarSeleccion(){seleccionadas.clear();renderTabla();}
function abrirUnirLote(){
  if(!seleccionadas.size) return;
  document.getElementById('mu-count').textContent=seleccionadas.size;
  document.getElementById('mu-lote').value='';document.getElementById('mu-fb').textContent='';
  abrirModal('modal-unir');setTimeout(()=>document.getElementById('mu-lote').focus(),100);
}
function validarLoteUnir(){
  const val=document.getElementById('mu-lote').value.trim();
  const fb=document.getElementById('mu-fb');if(!val){fb.textContent='';return;}
  const existe=lotes.some(l=>l.id===val);
  fb.innerHTML=existe?`<span class="fb-ok"><i class="ti ti-check"></i> Lote ${val} existente — se añadirán las facturas</span>`:`<span class="fb-warn"><i class="ti ti-alert-circle"></i> Lote nuevo — se creará con estas facturas</span>`;
}
function confirmarUnirLote(){
  const val=document.getElementById('mu-lote').value.trim();
  if(!val){document.getElementById('mu-fb').innerHTML=`<span class="fb-err"><i class="ti ti-alert-circle"></i> Ingresa un número de lote</span>`;return;}
  const claves=[...seleccionadas];let movidas=0;
  claves.forEach(k=>{
    const sp=k.replace('SL_','').split('_');const fIdx=facturasSinLote.findIndex(f=>f.serie===sp[0]&&f.num===sp[1]);if(fIdx<0) return;
    const f={...facturasSinLote[fIdx],lote:val};facturasSinLote.splice(fIdx,1);facturasRaw.push(f);
    extraSL=extraSL.filter(x=>!(x.serie===f.serie&&x.num===f.num));delete asignaciones[k];
    const lk=cL(val,f.serie);const lExist=lotes.find(l=>l.key===lk);
    if(lExist){lExist.monto+=f.monto;lExist.facturas+=1;lExist.soatCount=(lExist.soatCount||0)+(f.esSoat?1:0);lExist.esSoat=lExist.soatCount>0;}
    else{const nl={id:val,serie:f.serie,key:lk,aseg:f.aseg,monto:f.monto,facturas:1,fechaAt:f.fechaAt,fechaEstCsv:f.fechaEst,soatCount:f.esSoat?1:0,esSoat:f.esSoat};
      lotes.push(nl);if(!estados[lk]) estados[lk]={estado:'— sin estado —',fechaEst:f.fechaEst||'—'};}
    movidas++;
  });
  lsSet(LS_EXSL,extraSL);lsSet(LS_EST,estados);lsSet(LS_ASIGN,asignaciones);
  seleccionadas.clear();cerrarModal('modal-unir');poblarFiltros();renderTabla();renderMetrics();updateStorageInfo();
  showToast('toast-main','toast-msg',`${movidas} factura${movidas!==1?'s':''} unida${movidas!==1?'s':''} al lote ${val}`,'ok');
}

function abrirEditar(key){
  modalEditarKey=key;const l=lotes.find(x=>x.key===key);if(!l) return;
  document.getElementById('me-id').textContent=l.id;
  const facts=facturasRaw.filter(f=>f.lote===l.id&&f.serie===l.serie);
  document.getElementById('me-fact-list').innerHTML=facts.map(f=>`
    <div class="fact-item">
      <input type="checkbox" id="chk-${f.num}" value="${f.num}" onchange="cntRetiro()">
      <label for="chk-${f.num}"><strong>${f.num}</strong> · ${f.compania||'—'} · ${fmtMonto(f.monto)} · ${f.fechaAt}</label>
    </div>`).join('');
  document.getElementById('me-count').textContent='0 seleccionadas';
  abrirModal('modal-editar');
}
function cntRetiro(){
  const n=document.querySelectorAll('#me-fact-list input:checked').length;
  document.getElementById('me-count').textContent=`${n} factura${n!==1?'s':''} seleccionada${n!==1?'s':''}`;
}
function confirmarRetirar(){
  const l=lotes.find(x=>x.key===modalEditarKey);if(!l) return;
  const nums=[...document.querySelectorAll('#me-fact-list input:checked')].map(c=>c.value);
  if(!nums.length){cerrarModal('modal-editar');return;}
  nums.forEach(num=>{
    const idx=facturasRaw.findIndex(f=>f.lote===l.id&&f.serie===l.serie&&f.num===num);
    if(idx>-1){
      const f=facturasRaw.splice(idx,1)[0];const fSL={...f,lote:''};
      facturasSinLote.push(fSL);extraSL.push(fSL);
      const k=cSL(f.serie,f.num);if(!estados[k]) estados[k]={estado:'— sin estado —',fechaEst:f.fechaEst||'—'};
      l.monto-=f.monto;l.facturas-=1;l.soatCount=(l.soatCount||0)-(f.esSoat?1:0);l.esSoat=l.soatCount>0;
    }
  });
  lsSet(LS_EXSL,extraSL);lsSet(LS_EST,estados);
  if(l.facturas<=0){delete estados[l.key];delete historial[l.key];lotes=lotes.filter(x=>x.key!==l.key);lsSet(LS_EST,estados);lsSet(LS_HIST,historial);}
  cerrarModal('modal-editar');poblarFiltros();renderTabla();renderMetrics();updateStorageInfo();
  showToast('toast-main','toast-msg',`${nums.length} factura${nums.length!==1?'s':''} retirada${nums.length!==1?'s':''}. Aparecen en sección "Sin lote".`,'ok');
}

function abrirEliminar(key){
  modalEliminarKey=key;const l=lotes.find(x=>x.key===key);if(!l) return;
  document.getElementById('mel-id').textContent=`${l.id} (serie ${l.serie})`;abrirModal('modal-eliminar');
}
function confirmarEliminar(){
  const l=lotes.find(x=>x.key===modalEliminarKey);if(!l) return;
  const facts=facturasRaw.filter(f=>f.lote===l.id&&f.serie===l.serie);
  facts.forEach(f=>{
    const fSL={...f,lote:''};facturasSinLote.push(fSL);extraSL.push(fSL);
    const k=cSL(f.serie,f.num);if(!estados[k]) estados[k]={estado:'— sin estado —',fechaEst:f.fechaEst||'—'};
  });
  facturasRaw=facturasRaw.filter(f=>!(f.lote===l.id&&f.serie===l.serie));
  delete estados[l.key];delete historial[l.key];lotes=lotes.filter(x=>x.key!==l.key);
  lsSet(LS_EXSL,extraSL);lsSet(LS_EST,estados);lsSet(LS_HIST,historial);
  cerrarModal('modal-eliminar');poblarFiltros();renderTabla();renderMetrics();updateStorageInfo();
  showToast('toast-main','toast-msg',`Lote ${l.id} eliminado. Sus facturas quedaron sueltas.`,'ok');
}

function abrirModal(id){document.getElementById(id).classList.add('open');}
function cerrarModal(id){document.getElementById(id).classList.remove('open');}

function exportarReporte(){
  if(!facturasRaw.length&&!facturasSinLote.length){alert('No hay datos cargados');return;}
  const datos=[
    ...facturasRaw.map(f=>{const k=cL(f.lote,f.serie);const ei=estados[k]||{estado:'— sin estado —'};const obs=(historial[k]||[]).find(h=>h.nota)?.nota||'';
      return{LOTE:f.lote,SER_FACTURAEST:f.serie,NUM_FACTURAEST:f.num,ESTADO:estadoV(ei.estado),OBSERVACION:obs,MTONETO:f.monto,ASEGURADORA:f.aseg,COMPANIA:f.compania,FEC_ESTADO:f.fechaEst,FEC_ATENCION:f.fechaAt};}),
    ...facturasSinLote.map(f=>{const k=cSL(f.serie,f.num);const ei=estados[k]||{estado:'— sin estado —'};const obs=(historial[k]||[]).find(h=>h.nota)?.nota||'';
      return{LOTE:asignaciones[k]||'',SER_FACTURAEST:f.serie,NUM_FACTURAEST:f.num,ESTADO:estadoV(ei.estado),OBSERVACION:obs,MTONETO:f.monto,ASEGURADORA:f.aseg,COMPANIA:f.compania,FEC_ESTADO:f.fechaEst,FEC_ATENCION:f.fechaAt};}),
  ];
  const ws=XLSX.utils.json_to_sheet(datos);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Tramas');
  XLSX.writeFile(wb,`reporte_tramas_${todayISO()}.xlsx`);
}
function exportarRespaldo(){
  const data={estados,historial,asignaciones,extraSL,notas,exportado:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`tramas_respaldo_${todayISO()}.json`;a.click();
}
function restaurarRespaldo(input){
  const file=input.files[0];if(!file) return;
  const r=new FileReader();
  r.onload=e=>{
    try{
      const d=JSON.parse(e.target.result);
      if(d.estados){estados=d.estados;lsSet(LS_EST,estados);}
      if(d.historial){historial=d.historial;lsSet(LS_HIST,historial);}
      if(d.asignaciones){asignaciones=d.asignaciones;lsSet(LS_ASIGN,asignaciones);}
      if(d.extraSL){extraSL=d.extraSL;lsSet(LS_EXSL,extraSL);}
      if(d.notas){notas=d.notas;lsSet(LS_NOTAS,notas);renderNotas();}
      renderTabla();renderMetrics();updateStorageInfo();showToast('toast-main','toast-msg','Respaldo restaurado','ok');
    }catch(err){showToast('toast-main','toast-msg','Error: '+err.message,'err');}
  };
  r.readAsText(file);input.value='';
}
function limpiarDatos(){
  pedirConfirmacion('¿Limpiar los datos cargados?','El archivo se quitará de la vista. Los estados, historial y notas guardados se conservan.',()=>{
    lotes=[];facturasRaw=[];facturasSinLote=[];montoCsvFinal=null;seleccionadas.clear();
    document.getElementById('btn-export').disabled=true;
    document.getElementById('monto-check').style.display='none';
    const hoy=new Date().toLocaleDateString('es-PE',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
    document.getElementById('topbar-fecha').textContent=hoy.charAt(0).toUpperCase()+hoy.slice(1);
    mostrarContenido();renderMetrics();updateStorageInfo();
  });
}

// ─── PENDIENTES (to-do) ───────────────────────────────────────────────────────
function escHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtFechaCorta(iso){
  if(!iso) return '';
  const d=new Date(iso+'T12:00:00');if(isNaN(d)) return '';
  return d.toLocaleDateString('es-PE',{day:'2-digit',month:'short'});
}
let selNotaId=null;
function taskHtml(n){
  return `
    <div class="task-card${n.id===selNotaId?' selected':''}${n.hecha?' done':''}" onclick="seleccionarNota('${n.id}')">
      <button class="task-check${n.hecha?' done':''}" onclick="event.stopPropagation();toggleNota('${n.id}')" title="${n.hecha?'Marcar pendiente':'Completar'}">${n.hecha?'<i class="ti ti-check"></i>':''}</button>
      <div class="task-txt${n.hecha?' done':''}">${escHtml(n.titulo)||'<em>Sin título</em>'}</div>
      ${n.detalle?'<i class="ti ti-notes task-has-note" title="Tiene detalle"></i>':''}
      ${n.fecha?`<span class="task-date"><i class="ti ti-calendar-event"></i> ${fmtFechaCorta(n.fecha)}</span>`:''}
      <button class="task-del" onclick="event.stopPropagation();eliminarNota('${n.id}')" title="Eliminar"><i class="ti ti-x"></i></button>
    </div>`;
}

function renderNotas(){
  const pendList=document.getElementById('notas-list');
  if(!pendList) return;
  const pend=notas.filter(n=>!n.hecha), done=notas.filter(n=>n.hecha);
  pendList.innerHTML=pend.length?pend.map(taskHtml).join(''):'<div class="notas-empty"><i class="ti ti-clipboard-check"></i>Sin pendientes. Añade una tarea arriba.</div>';
  const doneWrap=document.getElementById('notas-done-wrap');
  const doneList=document.getElementById('notas-done-list');
  const doneCount=document.getElementById('notas-done-count');
  if(doneWrap){
    doneWrap.style.display=done.length?'block':'none';
    doneCount.textContent=done.length;
    doneList.innerHTML=done.map(taskHtml).join('');
  }
  const pendientes=pend.length;
  const nbadge=document.getElementById('notas-badge');
  if(nbadge){
    if(pendientes>0){nbadge.textContent=pendientes;nbadge.style.display='inline-flex';}
    else nbadge.style.display='none';
  }
}

function renderNotaDetalle(){
  const empty=document.getElementById('td-empty');
  const body=document.getElementById('td-body');
  if(!empty||!body) return;
  const n=notas.find(x=>x.id===selNotaId);
  if(!n){empty.style.display='flex';body.style.display='none';return;}
  empty.style.display='none';body.style.display='flex';
  const chk=document.getElementById('td-check');
  chk.className='task-check td-check'+(n.hecha?' done':'');
  chk.innerHTML=n.hecha?'<i class="ti ti-check"></i>':'';
  document.getElementById('td-fecha').value=n.fecha||'';
  const ti=document.getElementById('td-titulo');
  if(ti.value!==n.titulo) ti.value=n.titulo;
  ti.classList.toggle('done',!!n.hecha);
  const ta=document.getElementById('td-detalle');
  if(ta.value!==(n.detalle||'')) ta.value=n.detalle||'';
}

function seleccionarNota(id){
  selNotaId=id;
  renderNotas();renderNotaDetalle();
}

function __autosaveNota(campo,valor){
  const n=notas.find(x=>x.id===selNotaId);if(!n) return;
  n[campo]=valor;lsSet(LS_NOTAS,notas);
  if(campo==='titulo'){
    const el=document.querySelector('.task-card.selected .task-txt');
    if(el) el.textContent=valor.trim()||'Sin título';
  } else if(campo==='fecha'){
    renderNotas();
  }
  // 'detalle' no re-dibuja la lista: se guarda en silencio
}

function agregarNota(){
  const input=document.getElementById('notas-input');const titulo=input.value.trim();if(!titulo) return;
  const fecha=document.getElementById('notas-fecha')?.value||'';
  const id='n'+Date.now();
  notas.unshift({id,titulo,detalle:'',fecha,hecha:false});
  lsSet(LS_NOTAS,notas);input.value='';
  const df=document.getElementById('notas-fecha');if(df)df.value='';
  selNotaId=id;
  renderNotas();renderNotaDetalle();updateStorageInfo();
}
function toggleNota(id){const n=notas.find(x=>x.id===id);if(n){n.hecha=!n.hecha;lsSet(LS_NOTAS,notas);renderNotas();renderNotaDetalle();}}
// confirmación personalizada
let __confirmCb=null;
function pedirConfirmacion(titulo,sub,cb){
  const t=document.getElementById('mc-titulo'),s=document.getElementById('mc-sub');
  if(!t){if(confirm(titulo)) cb();return;}
  t.textContent=titulo;s.textContent=sub;
  __confirmCb=cb;abrirModal('modal-confirm');
}

function eliminarNota(id){
  const n=notas.find(x=>x.id===id);if(!n) return;
  pedirConfirmacion('¿Eliminar esta tarea?',`"${n.titulo}" se eliminará definitivamente junto con sus detalles.`,()=>{
    notas=notas.filter(x=>x.id!==id);lsSet(LS_NOTAS,notas);
    if(selNotaId===id) selNotaId=null;
    renderNotas();renderNotaDetalle();
  });
}

// ─── ANÁLISIS (gráficos) ─────────────────────────────────────────────────────
const CHARTS={};
const BRAND_SEQ=['#5c2168','#e87f17','#8a4fa0','#f0a04b','#3d1650','#c56a10','#a883b8','#f5c08a','#7a3a92','#d98a3d'];

function mkChart(id,cfg){
  const cv=document.getElementById(id);if(!cv) return;
  if(CHARTS[id]){CHARTS[id].destroy();delete CHARTS[id];}
  CHARTS[id]=new Chart(cv.getContext('2d'),cfg);
}

const RESUELTOS=['En colocaciones'];

function renderAnalisis(){
  if(typeof Chart==='undefined') return;
  const hay=lotes.length||facturasSinLote.length;
  const empty=document.getElementById('ana-empty');
  const wrap=document.getElementById('ana-wrap');
  if(!empty||!wrap) return;
  empty.style.display=hay?'none':'block';
  wrap.style.display=hay?'block':'none';
  if(!hay) return;

  Chart.defaults.font.family=getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size=11.5;
  Chart.defaults.color='#5a4668';

  const metric=document.getElementById('ana-metric')?.value||'monto';
  const esMonto=metric==='monto';
  const {filtL,filtSL}=filtrarDatos();
  const keysL=new Set(filtL.map(l=>l.key));
  const todasF=[...facturasRaw.filter(f=>keysL.has(cL(f.lote,f.serie))),...filtSL];
  const casos=[
    ...filtL.map(l=>({key:l.key,monto:l.monto,aseg:l.aseg,fecha:l.fechaEstCsv,id:l.id,esLote:true})),
    ...filtSL.map(f=>({key:cSL(f.serie,f.num),monto:f.monto,aseg:f.aseg,fecha:f.fechaEst,id:f.num,esLote:false}))
  ];
  casos.forEach(c=>c.estado=estadoV(estados[c.key]?.estado));

  // ── KPI cards ──
  const totalM=casos.reduce((a,c)=>a+c.monto,0);
  const resArr=casos.filter(c=>RESUELTOS.includes(c.estado));
  const pendArr=casos.filter(c=>!RESUELTOS.includes(c.estado));
  const cobradoM=resArr.reduce((a,c)=>a+c.monto,0);
  const pendM=totalM-cobradoM;
  const pctRes=casos.length?Math.round(resArr.length/casos.length*100):0;
  const hoy=Date.now();
  const diasArr=pendArr.map(c=>fechaTS(c.fecha)).filter(t=>t>0&&t<=hoy).map(t=>Math.round((hoy-t)/86400000));
  const promDias=diasArr.length?Math.round(diasArr.reduce((a,b)=>a+b,0)/diasArr.length):null;
  const cards=document.getElementById('ana-cards');
  if(cards) cards.innerHTML=`
    <div class="ana-card"><div class="ana-card-ico mi-purple"><i class="ti ti-cash"></i></div><div><div class="ana-card-label">Total facturado</div><div class="ana-card-val">${fmtMonto(totalM)}</div></div></div>
    <div class="ana-card"><div class="ana-card-ico mi-green"><i class="ti ti-circle-check"></i></div><div><div class="ana-card-label">Cobrado / resuelto</div><div class="ana-card-val ok">${fmtMonto(cobradoM)}</div></div></div>
    <div class="ana-card"><div class="ana-card-ico mi-orange"><i class="ti ti-hourglass"></i></div><div><div class="ana-card-label">Pendiente de cobro</div><div class="ana-card-val warn">${fmtMonto(pendM)}</div></div></div>
    <div class="ana-card"><div class="ana-card-ico mi-purple"><i class="ti ti-calendar-stats"></i></div><div><div class="ana-card-label">Días prom. sin cobrar</div><div class="ana-card-val">${promDias===null?'—':promDias+' días'}</div></div></div>
    <div class="ana-card"><div class="ana-card-ico mi-orange"><i class="ti ti-file-unknown"></i></div><div><div class="ana-card-label">Facturas sin lote</div><div class="ana-card-val warn">${filtSL.length}</div></div></div>`;

  // 1 — Donut % de resolución (centro con % grande)
  mkChart('ch-resol',{
    type:'doughnut',
    data:{labels:['Resueltos (En colocaciones)','Pendientes'],datasets:[{data:esMonto?[cobradoM,pendM]:[resArr.length,pendArr.length],backgroundColor:['#2aa15c','#e8dced'],borderWidth:2,borderColor:'#fff'}]},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:10,font:{size:10.5}}}},maintainAspectRatio:false,cutout:'68%'},
    plugins:[{id:'ctrTxt',afterDraw(ch){const{ctx,chartArea:a}=ch;if(!a)return;ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';const cx=(a.left+a.right)/2,cy=(a.top+a.bottom)/2;ctx.font='800 27px Manrope';ctx.fillStyle='#2aa15c';ctx.fillText(`${pctRes}%`,cx,cy-8);ctx.font='800 9.5px Manrope';ctx.fillStyle='#937fa1';ctx.fillText('RESUELTO',cx,cy+14);ctx.restore();}}]
  });

  // 2 — Barras: distribución por estado (cantidad o monto)
  const conteo={},montoE={};
  casos.forEach(c=>{conteo[c.estado]=(conteo[c.estado]||0)+1;montoE[c.estado]=(montoE[c.estado]||0)+c.monto;});
  const estAct=ESTADOS.filter(e=>conteo[e]);
  mkChart('ch-estados',{
    type:'bar',
    data:{labels:estAct.map(e=>e.length>15?e.slice(0,13)+'…':e),datasets:[{label:esMonto?'Monto (S/)':'N° casos',data:estAct.map(e=>esMonto?montoE[e]:conteo[e]),backgroundColor:estAct.map(e=>DOT_MAP[e]),borderRadius:6}]},
    options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{grid:{color:'#efe7f3'}},x:{grid:{display:false},ticks:{maxRotation:42,minRotation:0,font:{size:10}}}}}
  });

  // 3 — Barras apiladas: aseguradora × estado
  const asegTot={};
  casos.forEach(c=>{asegTot[c.aseg]=(asegTot[c.aseg]||0)+(esMonto?c.monto:1);});
  const topAsegs=Object.entries(asegTot).sort((a,b)=>b[1]-a[1]).slice(0,8).map(x=>x[0]);
  const dsets=estAct.map(e=>({
    label:e,
    data:topAsegs.map(a=>casos.filter(c=>c.aseg===a&&c.estado===e).reduce((s,c)=>s+(esMonto?c.monto:1),0)),
    backgroundColor:DOT_MAP[e],borderRadius:3,stack:'s'
  })).filter(d=>d.data.some(v=>v>0));
  mkChart('ch-comp',{
    type:'bar',
    data:{labels:topAsegs.map(a=>a.length>15?a.slice(0,13)+'…':a),datasets:dsets},
    options:{plugins:{legend:{position:'bottom',labels:{boxWidth:9,font:{size:9.5}}}},maintainAspectRatio:false,scales:{x:{stacked:true,grid:{display:false},ticks:{maxRotation:42,font:{size:10}}},y:{stacked:true,grid:{color:'#efe7f3'}}}}
  });

  // 4 — Top 5 lotes pendientes por monto (horizontal)
  const topLotes=casos.filter(c=>c.esLote&&!RESUELTOS.includes(c.estado)).sort((a,b)=>b.monto-a.monto).slice(0,5);
  mkChart('ch-top',{
    type:'bar',
    data:{labels:topLotes.map(l=>'Lote '+l.id),datasets:[{label:'Monto (S/)',data:topLotes.map(l=>l.monto),backgroundColor:['#5c2168','#7a3a92','#8a4fa0','#a883b8','#c3a6cf'],borderRadius:6}]},
    options:{indexAxis:'y',plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{x:{grid:{color:'#efe7f3'}},y:{grid:{display:false}}}}
  });

  // 5 — Línea: evolución mensual (usa TODOS los datos, independiente de filtros)
  const MES_N=['','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const todasFull=[...facturasRaw,...facturasSinLote];
  const selMesAnio=document.getElementById('ana-mes-anio');
  if(selMesAnio){
    const aniosDisp=[...new Set(todasFull.map(f=>{const p=(f.fechaEst||'').split('/');return p.length===3?p[2]:null;}).filter(Boolean))].sort((a,b)=>b-a);
    const valActual=selMesAnio.value;
    selMesAnio.innerHTML='<option value="">Todos los años</option>'+aniosDisp.map(a=>`<option value="${a}"${a===valActual?' selected':''}>${a}</option>`).join('');
    if(!selMesAnio._wired){selMesAnio.addEventListener('change',renderAnalisis);selMesAnio._wired=true;}
  }
  const anioFiltMes=selMesAnio?selMesAnio.value:'';
  const meses={},mesesN={};
  todasFull.forEach(f=>{
    const p=(f.fechaEst||'').split('/');
    if(p.length===3){
      if(anioFiltMes&&p[2]!==anioFiltMes) return;
      const k=`${p[2]}-${p[1]}`;meses[k]=(meses[k]||0)+f.monto;mesesN[k]=(mesesN[k]||0)+1;
    }
  });
  const mk=Object.keys(meses).sort();
  mkChart('ch-mes',{
    type:'line',
    data:{labels:mk.map(k=>{const[y,m]=k.split('-');return `${MES_N[+m]||m} ${y.slice(2)}`;}),datasets:[{label:esMonto?'Monto facturado (S/)':'N° facturas',data:mk.map(k=>esMonto?meses[k]:mesesN[k]),borderColor:'#e87f17',backgroundColor:'rgba(232,127,23,0.12)',fill:true,tension:0.35,pointBackgroundColor:'#e87f17',pointRadius:4}]},
    options:{plugins:{legend:{display:false}},maintainAspectRatio:false,scales:{y:{grid:{color:'#efe7f3'}},x:{grid:{display:false}}}}
  });
}

// ─── SHELL ───────────────────────────────────────────────────────────────────
function showView(v){
  vistaActual=v;
  document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active', x.id==='view-'+v));
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  aplicarVisibilidadVista();
  if(v==='analisis') renderAnalisis();
}

function __on(id,ev,fn){const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);}

function __wire(){
  document.querySelectorAll('.nav-item[data-view]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
  __on('btn-export','click',exportarReporte);
  __on('file-input','change',function(){importarArchivo(this);});
  __on('btn-limpiar-datos','click',limpiarDatos);
  const dz=document.getElementById('drop-zone');
  if(dz){
    dz.addEventListener('click',()=>document.getElementById('file-input').click());
    dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('drag');});
    dz.addEventListener('dragleave',()=>dz.classList.remove('drag'));
    dz.addEventListener('drop',onDrop);
  }
  __on('search','input',onSearch);
  __on('fil-anio','change',()=>{renderTabla();renderMetrics();});
  ['ms-aseg','ms-comp'].forEach(p=>__on(p+'-btn','click',e=>{
    e.stopPropagation();
    document.querySelectorAll('.ms-panel.open').forEach(x=>{if(x.id!==p+'-panel')x.classList.remove('open');});
    document.getElementById(p+'-panel').classList.toggle('open');
  }));
  document.addEventListener('click',e=>{
    if(!e.target.closest('.mselect')) document.querySelectorAll('.ms-panel.open').forEach(x=>x.classList.remove('open'));
  });
  __on('mc-cancel','click',()=>{__confirmCb=null;cerrarModal('modal-confirm');});
  __on('mc-confirm','click',()=>{cerrarModal('modal-confirm');const cb=__confirmCb;__confirmCb=null;if(cb)cb();});
  __on('fil-est','change',()=>{renderTabla();renderMetrics();});
  __on('orden-sel','change',renderTabla);
  __on('btn-limpiar-filtros','click',limpiarFiltros);
  __on('btn-banner-clear','click',limpiarBusqueda);
  __on('btn-volver','click',showMain);
  __on('btn-guardar-det','click',guardarEstadoDetalle);
  __on('ma-cancel','click',()=>cerrarModal('modal-asignar'));
  __on('ma-btn-quitar','click',quitarAsignacion);
  __on('ma-confirm','click',confirmarAsignar);
  __on('ma-lote','input',validarLoteAsignar);
  __on('me-cancel','click',()=>cerrarModal('modal-editar'));
  __on('me-confirm','click',confirmarRetirar);
  __on('mel-cancel','click',()=>cerrarModal('modal-eliminar'));
  __on('mel-confirm','click',confirmarEliminar);
  __on('mu-cancel','click',()=>cerrarModal('modal-unir'));
  __on('mu-confirm','click',confirmarUnirLote);
  __on('mu-lote','input',validarLoteUnir);
  __on('notas-add-btn','click',agregarNota);
  __on('notas-input','keydown',e=>{if(e.key==='Enter')agregarNota();});
  __on('td-titulo','input',e=>__autosaveNota('titulo',e.target.value));
  __on('td-detalle','input',e=>__autosaveNota('detalle',e.target.value));
  __on('td-fecha','change',e=>__autosaveNota('fecha',e.target.value));
  __on('td-check','click',()=>{if(selNotaId)toggleNota(selNotaId);});
  __on('td-del','click',()=>{if(selNotaId)eliminarNota(selNotaId);});
  __on('ana-metric','change',renderAnalisis);
  const dt=document.getElementById('notas-done-toggle');
  if(dt) dt.addEventListener('click',()=>{
    const w=document.getElementById('notas-done-wrap');
    w.classList.toggle('collapsed');
  });
  document.querySelectorAll('.modal-overlay').forEach(m=>m.addEventListener('click',function(e){if(e.target===this) cerrarModal(this.id);}));
}

window.__csjbInit = async function() {
  if (window.__csjbInited) return;
  window.__csjbInited = true;

  poblarSelectsEstados();
  const hoy = new Date().toLocaleDateString('es-PE', {weekday:'long',year:'numeric',month:'long',day:'numeric'});
  const tf = document.getElementById('topbar-fecha');
  if (tf) tf.textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);
  __wire();
  showView('lotes');

  // mostrar login
  document.getElementById('login-screen').style.display = 'flex';

  // intentar restaurar sesión
  const restored = await sbRestoreSession();
  if (restored) {
    await iniciarSesionUsuario(window.currentUser);
  }
};

async function iniciarSesionUsuario(user) {
  // mostrar usuario en topbar
  const badge = document.getElementById('user-badge');
  const avatar = document.getElementById('user-avatar');
  const nombre = document.getElementById('user-nombre');
  if (badge) badge.style.display = 'flex';
  if (avatar) avatar.textContent = user.nombre.charAt(0).toUpperCase();
  if (nombre) nombre.textContent = user.nombre;
  document.body.classList.toggle('rol-jefe', user.rol === 'jefe');
  document.body.classList.toggle('rol-tramador', user.rol === 'tramador');
  const jefeBar = document.getElementById('jefe-bar');
  if (jefeBar) jefeBar.classList.toggle('visible', user.rol === 'jefe');

  // ocultar login
  document.getElementById('login-screen').style.display = 'none';

  if (user.rol === 'tramador') {
    // cargar datos desde supabase
    mostrarToast('Cargando datos…', 'ok');
    const datos = await sbCargarTodo(user.id);
    if (datos) aplicarDatosSupabase(datos);
    // cargar excel del día si existe
    const excel = await sbCargarExcel(user.id);
    if (excel && excel.archivo) {
      mostrarToast(`Cargando Excel del día: ${excel.nombre}…`, 'ok');
      const bin = atob(excel.archivo);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      procesarArchivo(arr.buffer, excel.nombre);
    } else {
      mostrarContenido(); updateStorageInfo();
      const nEst = Object.keys(estados).length;
      mostrarToast(nEst > 0 ? `${nEst} estados recuperados` : 'Bienvenido. Sube el Excel para comenzar.', 'ok');
    }
  } else {
    // jefe: espera que haga clic en tramador
    mostrarContenido(); updateStorageInfo();
  }
  renderNotas(); renderNotaDetalle();
}

function aplicarDatosSupabase(datos) {
  // limpiar localStorage y aplicar datos de supabase
  if (datos[LS_EST])   { estados      = datos[LS_EST];   localStorage.setItem(LS_EST,   JSON.stringify(estados)); }
  if (datos[LS_HIST])  { historial    = datos[LS_HIST];  localStorage.setItem(LS_HIST,  JSON.stringify(historial)); }
  if (datos[LS_ASIGN]) { asignaciones = datos[LS_ASIGN]; localStorage.setItem(LS_ASIGN, JSON.stringify(asignaciones)); }
  if (datos[LS_EXSL])  { extraSL      = datos[LS_EXSL];  localStorage.setItem(LS_EXSL,  JSON.stringify(extraSL)); }
  if (datos[LS_NOTAS]) { notas        = datos[LS_NOTAS]; localStorage.setItem(LS_NOTAS, JSON.stringify(notas)); }
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const err   = document.getElementById('login-err');
  const btn   = document.getElementById('login-btn');
  if (!email || !pass) { err.textContent = 'Ingresa email y contraseña'; return; }
  btn.textContent = 'Ingresando…'; btn.disabled = true; err.textContent = '';
  try {
    const user = await sbLogin(email, pass);
    await iniciarSesionUsuario(user);
  } catch(e) {
    err.textContent = e.message || 'Error al iniciar sesión';
    btn.textContent = 'Ingresar'; btn.disabled = false;
  }
}

// expose fns used by inline onclick handlers in generated rows
Object.assign(window,{cambiarEstado,showDetail,abrirEditar,abrirEliminar,toggleSeleccion,abrirAsignar,abrirUnirLote,limpiarSeleccion,cntRetiro,toggleNota,seleccionarNota,eliminarNota,cerrarModal,doLogin,jefeCambiarTramador,sbLogout,iniciarSesionUsuario,aplicarDatosSupabase});
} // fin guard __csjbLoaded
