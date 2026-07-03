/* Bandeau clients (landing + entreprises) : boucle infinie + interaction.
   - Avant toute interaction : animation CSS d'origine (Suez centré, 80 s/jeu, apparition au scroll).
   - Clic/toucher : la bande s'arrête et SUIT le curseur (drag).
   - Relâcher en « lançant » : inertie proportionnelle à la force du geste, freinage progressif,
     puis reprise du défilement automatique (jamais d'arrêt sec).
   Testable sans rAF : window.__lsClients.step(dt) / state() — le rAF appelle la même step(). */
(function(){
  var marquee=document.getElementById('clients-marquee');
  var track=document.getElementById('marquee-track');
  if(!marquee||!track) return;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce){ marquee.classList.add('in'); return; }

  var DURATION=80; // secondes pour traverser un jeu (vitesse auto)
  var originals=Array.prototype.slice.call(track.children);
  for(var c=0;c<2;c++){
    originals.forEach(function(n){ var cl=n.cloneNode(true); cl.setAttribute('aria-hidden','true'); track.appendChild(cl); });
  }

  var W=0,startX=0,autoV=0; // un jeu = W px ; bande utile = (startX-W, startX] ; autoV en px/s (négatif = vers la gauche)
  var mode='css';           // css | auto | drag | momentum (css = animation d'origine avant la 1re interaction)
  var x=0,v=0;

  function layout(){
    W=track.scrollWidth/3;
    autoV=-W/DURATION;
    var first=track.children[0];
    var suezCenter=first.offsetLeft+first.offsetWidth/2;
    var C=marquee.clientWidth/2;
    startX=Math.round(C-(W+suezCenter));
    if(mode==='css'){
      var endX=Math.round(startX-W);
      var st=document.getElementById('clients-kf');
      if(!st){ st=document.createElement('style'); st.id='clients-kf'; document.head.appendChild(st); }
      st.textContent='@keyframes clients-run{from{transform:translateX('+startX+'px)}to{transform:translateX('+endX+'px)}}';
      var running=marquee.classList.contains('in');
      track.style.transform='translateX('+startX+'px)';
      track.style.animation='clients-run '+DURATION+'s linear infinite';
      track.style.animationPlayState=running?'running':'paused';
    } else { wrapX(); apply(); }
  }
  function wrapX(){ while(x>startX) x-=W; while(x<=startX-W) x+=W; }
  function apply(){ track.style.transform='translateX('+x+'px)'; }
  function currentX(){
    var t=getComputedStyle(track).transform;
    if(!t||t==='none') return startX;
    try{ return new DOMMatrixReadOnly(t).m41; }
    catch(e){ var m=t.match(/-?[\d.]+/g); return m&&m.length>4?parseFloat(m[4]):startX; }
  }

  /* physique : appelée par le rAF (et par les tests) */
  function step(dt){
    if(mode==='auto'){ x+=autoV*dt; wrapX(); apply(); }
    else if(mode==='momentum'){
      x+=v*dt; wrapX(); apply();
      v=autoV+(v-autoV)*Math.exp(-dt*2.2); // freinage exponentiel vers la vitesse auto
      if(Math.abs(v-autoV)<12){ v=autoV; mode='auto'; }
    }
  }
  var rafOn=false,last=0;
  function loop(t){ step(Math.min((t-last)/1000,0.05)); last=t; requestAnimationFrame(loop); }
  function takeOver(){ // 1re interaction : on fige l'animation CSS là où elle est et le JS prend la main
    if(mode!=='css') return;
    x=currentX(); track.style.animation='none'; wrapX(); apply();
    mode='auto';
    if(!rafOn){ rafOn=true; last=performance.now(); requestAnimationFrame(loop); }
  }

  /* drag + lancer — sur la piste des logos uniquement (pas le padding du bandeau) */
  var lastPX=0,lastPT=0,samples=[];
  track.addEventListener('pointerdown',function(e){
    if(e.button!==undefined&&e.button!==0&&e.pointerType==='mouse') return;
    takeOver(); mode='drag';
    lastPX=e.clientX; lastPT=performance.now(); samples=[];
    marquee.classList.add('dragging');
    try{ track.setPointerCapture(e.pointerId); }catch(_){}
    e.preventDefault();
  });
  track.addEventListener('pointermove',function(e){
    if(mode!=='drag') return;
    var now=performance.now(), dx=e.clientX-lastPX;
    x+=dx; wrapX(); apply();
    var dt=(now-lastPT)/1000;
    if(dt>0) samples.push({v:dx/dt,t:now});
    while(samples.length&&now-samples[0].t>120) samples.shift();
    lastPX=e.clientX; lastPT=now;
  });
  function release(){
    if(mode!=='drag') return;
    marquee.classList.remove('dragging');
    var now=performance.now();
    var rec=samples.filter(function(s){ return now-s.t<120; });
    var fv=rec.length?rec.reduce(function(a,s){ return a+s.v; },0)/rec.length:0;
    fv=Math.max(-3200,Math.min(3200,fv)); // borne les lancers extrêmes
    if(Math.abs(fv-autoV)<40){ v=autoV; mode='auto'; }
    else { v=fv; mode='momentum'; }
  }
  track.addEventListener('pointerup',release);
  track.addEventListener('pointercancel',release);

  layout();
  window.addEventListener('load',layout);
  var rt; window.addEventListener('resize',function(){ clearTimeout(rt); rt=setTimeout(layout,150); });

  function appear(){ marquee.classList.add('in'); if(mode==='css') track.style.animationPlayState='running'; }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ appear(); io.unobserve(marquee); } }); },{threshold:0.3});
    io.observe(marquee);
  } else { appear(); }

  window.__lsClients={ step:step, takeOver:takeOver, state:function(){ return {mode:mode,x:x,v:v,W:W,startX:startX,autoV:autoV}; } };
})();
