/* ============================================================================
   L&S — Logo morphing 3D : nuage de particules rose-gold en volume autour du
   logo, qui tourne en perspective et se métamorphose en boucle :
   anneau -> galaxie -> cerveau (sphère/réseau) -> robot (cube/circuit) -> peinture.
   ============================================================================ */
(function () {
  'use strict';
  var stage = document.getElementById('medallion-stage');
  if (!stage) return;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  var canvas = document.createElement('canvas');
  canvas.className = 'morph-canvas';
  stage.appendChild(canvas);
  var logo = document.createElement('div');
  logo.className = 'morph-logo';
  logo.setAttribute('role','img');
  logo.setAttribute('aria-label','Languages & Success');
  var logoImg = document.createElement('img');
  logoImg.className = 'logo-img'; logoImg.src = 'assets/ls-logo.png'; logoImg.alt = '';
  var logoSheen = document.createElement('span');
  logoSheen.className = 'logo-sheen';
  logo.appendChild(logoImg); logo.appendChild(logoSheen);
  stage.appendChild(logo);
  var ctx = canvas.getContext('2d');
  // canvas hors-écran basse résolution pour un bloom rapide
  var bcanvas = document.createElement('canvas');
  var bctx = bcanvas.getContext('2d');
  var BLOOM_SCALE = 0.4;

  var COLORS = ['#be6e54', '#f3ad99', '#cf855f', '#e8b9a6', '#ffe2bd', '#a8593c'].map(hx);
  function hx(c){ c=c.replace('#',''); return [parseInt(c.substr(0,2),16),parseInt(c.substr(2,2),16),parseInt(c.substr(4,2),16)]; }
  // PERF : l'opacité passe partout par globalAlpha (un simple nombre) plutôt que par une
  // chaîne « rgba(…) » reconstruite pour chacune des ~600 particules dessinées à chaque image :
  // Blink ne met en cache que la dernière couleur analysée, c'étaient autant d'analyses CSS.
  // Les couleurs, elles, sont opaques et fixes (voir OPAQUE ci-dessous).
  var AL = 256;
  // opacité -> même valeur que celle qu'obtenait la chaîne rgba(…, a.toFixed(3)) d'origine :
  // quantification sur 256 pas PUIS arrondi à 3 décimales. Rendu identique au pixel près.
  var qa = function(a){ return a<=0 ? 0 : (a>=1 ? AL : (a*AL)|0); };
  var al3 = function(q){ return Math.round(q/AL*1000)/1000; };
  // couleurs OPAQUES : l'opacité passe désormais par globalAlpha (aucune analyse de chaîne CSS)
  var OPAQUE = COLORS.map(function(c){ return 'rgb('+c[0]+','+c[1]+','+c[2]+')'; });
  var OPAQUE_WHITE = 'rgb(255,250,239)', OPAQUE_SPARK = 'rgb(255,244,224)';

  var N = 200;
  var P = [];
  for (var i=0;i<N;i++){ var ci=(Math.random()*COLORS.length)|0; P.push({ x:0,y:0,z:0, ci:ci, c:COLORS[ci], s:1.1+Math.random()*1.6, ph:Math.random()*6.28, tk:Math.random()*6.28, ts:0.5+Math.random()*1.3 }); }

  // rayons lumineux asymétriques / aléatoires émanant du logo
  var RAYS = [];
  (function(){ for(var i=0;i<10;i++){ RAYS.push({ a:Math.random()*6.283, len:1.3+Math.random()*1.9, w:0.018+Math.random()*0.03, sp:0.5+Math.random()*1.5, ph:Math.random()*6.283, rot:(Math.random()-0.5)*0.07 }); } })();

  // état de rotation / visibilité
  var LOGO_T = 11;            // secondes pour un tour complet
  var visible = true, running = true;

  var W=1,H=1,cx=0,cy=0,R=1,rIn=1,D=1, scenes=[], bw=1, bh=1;

  function pad(p){ while(p.length<N){ var u=Math.random(),v=Math.random(),th=6.283*u,ph=Math.acos(2*v-1); p.push([Math.sin(ph)*Math.cos(th)*R*0.9,Math.sin(ph)*Math.sin(th)*R*0.9,Math.cos(ph)*R*0.9]); } return p.slice(0,N); }

  // ---- formes 3D (points relatifs au centre) ------------------------------
  function ring(){ var p=[]; for(var i=0;i<N;i++){ var a=i/N*6.283; p.push([Math.cos(a)*R*0.98, Math.sin(a)*R*0.98, 0]); } return p; }
  function galaxy(){ var p=[]; for(var i=0;i<N;i++){ var t=i/N, arm=(i%3)*2.094, a=t*5+arm, r=rIn+t*(R*1.05-rIn); p.push([Math.cos(a)*r, Math.sin(a)*r, (Math.random()-0.5)*R*0.18]); } return p; }
  function brain(){ var p=[]; for(var i=0;i<N;i++){ var u=Math.random(),v=Math.random(),th=6.283*u,ph=Math.acos(2*v-1),r=rIn+Math.random()*(R*0.9-rIn); p.push([Math.sin(ph)*Math.cos(th)*r, Math.sin(ph)*Math.sin(th)*r*0.95, Math.cos(ph)*r]); } return p; }
  function circuit(){ var p=[]; var g=4, step=(R*1.8)/(g-1), o=-R*0.9; for(var a=0;a<g;a++)for(var b=0;b<g;b++)for(var c=0;c<g;c++){ if(a>0&&a<g-1&&b>0&&b<g-1&&c>0&&c<g-1) continue; var x=o+a*step,y=o+b*step,z=o+c*step; if(Math.hypot(x,y,z)<rIn*0.8) continue; p.push([x,y,z]); } return pad(p); }
  function paint(){ var p=[]; for(var i=0;i<N;i++){ var u=Math.random(),v=Math.random(),th=6.283*u,ph=Math.acos(2*v-1),r=Math.pow(Math.random(),0.5)*R*1.0; p.push([Math.sin(ph)*Math.cos(th)*r, Math.sin(ph)*Math.sin(th)*r, Math.cos(ph)*r]); } return pad(p); }

  var META = [ {b:ring,t:'dots'}, {b:brain,t:'net'}, {b:paint,t:'paint'} ];
  var si = 0;

  function size(){
    var r = stage.getBoundingClientRect();
    W=Math.max(1,r.width); H=Math.max(1,r.height);
    canvas.width=W*dpr; canvas.height=H*dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    // PERF : la ZONE UTILE du tampon de bloom reste W*0,4 (216 px pour un stage de 540), mais le
    // tampon lui-même fait au moins 256x256 : en dessous de ce seuil, Chrome peut refuser
    // d'accelerer un canvas 2D, et lire dedans obligerait alors a rapatrier le canvas principal
    // du GPU vers le CPU a chaque image. Le rendu ne change pas : on ne lit que la zone utile.
    bw=Math.max(1,Math.round(W*BLOOM_SCALE)); bh=Math.max(1,Math.round(H*BLOOM_SCALE));
    bcanvas.width=Math.max(256,bw); bcanvas.height=Math.max(256,bh);
    cx=W/2; cy=H/2; R=Math.min(W,H)*0.44; rIn=Math.min(W,H)*0.24; D=R*3.4;
    scenes = META.map(function(m){ return m.b(); });
    buildGradients();
  }

  // PERF : les dégradés du cœur étaient recréés à CHAQUE image (2,1 ms) et ceux des
  // 10 rayons aussi (1,6 ms). Ils ne dépendent que de la taille et de la pulsation :
  // on les construit une fois par redimensionnement, la pulsation étant échantillonnée
  // sur 32 pas (imperceptible à l'œil sur une respiration de plusieurs secondes).
  var PULSE_STEPS = 32, gbCache = [], gcCache = [], rayGrad = null;
  var RAY_AL_MAX = 0.26;   // valeur maximale de l'opacité d'un rayon (0.08 + 0.18)
  function buildGradients(){
    gbCache = []; gcCache = [];
    for(var k=0;k<PULSE_STEPS;k++){
      var pulse = k/(PULSE_STEPS-1);
      var bR = R*(1.05 + 0.10*pulse);
      var gb = ctx.createRadialGradient(cx,cy,0,cx,cy,bR);
      gb.addColorStop(0.00,'rgba(255,242,220,'+(0.20+0.08*pulse).toFixed(3)+')');
      gb.addColorStop(0.18,'rgba(255,206,158,'+(0.13+0.06*pulse).toFixed(3)+')');
      gb.addColorStop(0.55,'rgba(207,133,95,0.05)');
      gb.addColorStop(1.00,'rgba(190,110,84,0)');
      gbCache.push({ g:gb, r:bR });
      var cR = R*(0.46 + 0.06*pulse);
      var gc = ctx.createRadialGradient(cx,cy,0,cx,cy,cR);
      gc.addColorStop(0.00,'rgba(255,251,240,'+(0.48*(0.85+0.15*pulse)).toFixed(3)+')');
      gc.addColorStop(0.30,'rgba(255,224,184,'+(0.30*(0.85+0.15*pulse)).toFixed(3)+')');
      gc.addColorStop(0.70,'rgba(232,160,118,0.12)');
      gc.addColorStop(1.00,'rgba(207,133,95,0)');
      gcCache.push({ g:gc, r:cR });
    }
    // un SEUL dégradé de rayon, défini en espace unitaire (0 → 1) : la transformation
    // du canvas l'étire à la bonne longueur au moment du dessin (vérifié), l'intensité
    // étant portée par globalAlpha.
    rayGrad = ctx.createLinearGradient(0,0,1,0);
    rayGrad.addColorStop(0.00,'rgba(255,242,218,'+RAY_AL_MAX.toFixed(3)+')');
    rayGrad.addColorStop(0.45,'rgba(255,206,158,'+(RAY_AL_MAX*0.45).toFixed(3)+')');
    rayGrad.addColorStop(1.00,'rgba(255,190,140,0)');
  }

  var t0=0, sceneStart=0, SCENE_MS=4400;
  var rx=[],ry=[],rz=[],sx=[],sy=[],ff=[],order=[];
  // valeurs par particule calculées une seule fois par image (profondeur, scintillement, rayon)
  var DEP=new Float64Array(N), TW=new Float64Array(N), RAD=new Float64Array(N);
  for(var oi=0;oi<N;oi++) order[oi]=oi;              // ordre initial ; ensuite on garde celui de
  function byDepth(a,b){ return rz[a]-rz[b]; }       // l'image précédente : le tri est quasi trié

  // L'animation tourne en continu à la cadence de l'écran (60 images/seconde) tant que
  // le héros est visible. Elle n'est mise en pause QUE lorsqu'il quitte l'écran, et la
  // reprise décale l'origine du temps pour repartir exactement où l'on s'était arrêté
  // (sans ce décalage, l'animation sauterait proportionnellement à la durée de la pause).
  var pausedAt = 0;

  function frame(now){
    if(!t0){ t0=now; sceneStart=now; }
    if(pausedAt){ var gap=now-pausedAt; t0+=gap; sceneStart+=gap; pausedAt=0; }
    var t=(now-t0)/1000;
    if(now-sceneStart>SCENE_MS){ si=(si+1)%META.length; sceneStart=now; }
    var meta=META[si], pts=scenes[si];

    // rotation globale 3D
    var aY=t*0.42, aX=-0.42+Math.sin(t*0.25)*0.14;
    var cY=Math.cos(aY),sY=Math.sin(aY),cX=Math.cos(aX),sX=Math.sin(aX);

    for(var i=0;i<N;i++){
      var tg=pts[i];
      P[i].x+=(tg[0]-P[i].x)*0.07; P[i].y+=(tg[1]-P[i].y)*0.07; P[i].z+=(tg[2]-P[i].z)*0.07;
      // rotateY then rotateX
      var x=P[i].x, y=P[i].y, z=P[i].z;
      var x1=x*cY - z*sY, z1=x*sY + z*cY;
      var y2=y*cX - z1*sX, z2=y*sX + z1*cX;
      rx[i]=x1; ry[i]=y2; rz[i]=z2;
      var f=D/(D - z2); ff[i]=f;
      sx[i]=cx + x1*f; sy[i]=cy + y2*f;
    }
    order.sort(byDepth);   // loin -> près ; le tableau reste trie d une image a l autre

    ctx.clearRect(0,0,W,H);

    // --- NOYAU DE GALAXIE : halo lumineux qui palpite derrière le logo ------
    var pulse = 0.5 + 0.5*Math.sin(t*1.7);
    var pk = (pulse*(PULSE_STEPS-1) + 0.5)|0;
    ctx.globalCompositeOperation = 'lighter';
    // grand bloom diffus (dégradé pré-calculé)
    var eb = gbCache[pk];
    ctx.fillStyle=eb.g; ctx.beginPath(); ctx.arc(cx,cy,eb.r,0,6.283); ctx.fill();
    // cœur chaud, plus serré (dégradé pré-calculé)
    var ec = gcCache[pk], coreR = ec.r;
    ctx.fillStyle=ec.g; ctx.beginPath(); ctx.arc(cx,cy,coreR,0,6.283); ctx.fill();
    // rayons lumineux asymétriques qui jaillissent du logo (dégradé unitaire partagé,
    // étiré par la transformation ; l'intensité passe par globalAlpha)
    ctx.fillStyle=rayGrad;
    for(var ri=0; ri<RAYS.length; ri++){
      var rj=RAYS[ri];
      var beat=Math.max(0,Math.sin(t*rj.sp+rj.ph));
      var L = coreR*rj.len*(0.5+0.5*beat);
      var wd = R*rj.w*(0.7+0.3*beat);
      ctx.save();
      ctx.translate(cx,cy); ctx.rotate(rj.a + t*rj.rot); ctx.scale(L, wd);
      ctx.globalAlpha = (0.08+0.18*beat)/RAY_AL_MAX;
      ctx.beginPath(); ctx.moveTo(0,-1); ctx.lineTo(1,-0.10); ctx.lineTo(1,0.10); ctx.lineTo(0,1); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    // connexions (cerveau / circuit) — distance 3D (invariante par rotation)
    // ⚠️ PERF, CONTRE-INTUITIF — NE PAS « OPTIMISER » EN REGROUPANT LES LIGNES :
    // regrouper les ~4 000 segments en ~70 tracés (un par teinte) semble malin, mais c'est
    // SEPT FOIS PLUS LENT. Mesuré sur le vrai canvas 990×990 (médiane de 7 séries entrelacées) :
    //   un stroke() par ligne + globalAlpha ......  3,3 ms   ← retenu
    //   un stroke() par ligne + chaîne rgba() ....  5,0 ms
    //   un seul stroke() pour tout ............... 30,7 ms
    //   regroupé par teinte (~70 tracés) ......... 36,2 ms
    // Un chemin à nombreux sous-chemins force un rendu lent, alors que des segments isolés
    // empruntent un chemin optimisé. L'opacité passe par globalAlpha (un nombre) plutôt que par
    // une chaîne rgba() reconstruite : c'est ce qui explique le reste de l'écart.
    if(meta.t==='net'){
      var th=R*0.42, th2=th*th;
      ctx.lineWidth=1; ctx.strokeStyle=OPAQUE[0];              // COLORS[0] = l'accent #be6e54
      for(i=0;i<N;i++){ for(var k=i+1;k<N;k++){
        var dx=P[i].x-P[k].x, dy=P[i].y-P[k].y, dz=P[i].z-P[k].z, d2=dx*dx+dy*dy+dz*dz;
        if(d2>th2) continue;                                   // comparaison des carrés : pas de racine inutile
        var fa=(ff[i]+ff[k])*0.5;
        // Opacité : on reproduit EXACTEMENT l'arrondi à 3 décimales que faisait la chaîne
        // rgba(…, a.toFixed(3)) d'origine, pour un rendu identique au pixel près — mais sans
        // construire ni analyser la moindre chaîne (globalAlpha prend un nombre).
        var al=Math.round((1-Math.sqrt(d2)/th)*0.30*Math.min(1,fa)*1000)/1000;
        if(al<=0) continue;                                    // rien ne serait peint
        ctx.globalAlpha=al;
        ctx.beginPath(); ctx.moveTo(sx[i],sy[i]); ctx.lineTo(sx[k],sy[k]); ctx.stroke();
      } }
      ctx.globalAlpha=1;
    }

    // PERF : profondeur, scintillement et rayon étaient recalculés À L'IDENTIQUE dans les trois
    // boucles ci-dessous (jusqu'à 400 sinus inutiles par image). On les calcule une fois.
    var dots=(meta.t==='dots'), mulR=(meta.t==='paint')?1.7:1;
    for(var pi=0;pi<N;pi++){
      var fp=ff[pi];
      DEP[pi]=Math.max(0.25, Math.min(1, (fp-0.74)/0.62));
      TW[pi]=dots?(0.6+0.4*Math.sin(t*2+P[pi].ph)):1;
      RAD[pi]=P[pi].s*fp*mulR;
    }

    // PERF : l'opacité passe par globalAlpha (un simple nombre) au lieu d'une chaîne « rgba(…) »
    // différente à chaque particule — Blink ne met en cache que la dernière couleur analysée, et
    // c'étaient ~450 analyses de couleur CSS par image. La couleur, elle, ne change que rarement.
    // Résultat mathématiquement identique : couleur opaque × globalAlpha = même source prémultipliée.

    // halos additifs (brillance, du fond vers l'avant)
    ctx.globalCompositeOperation='lighter';
    var last=-1;
    for(var o=0;o<N;o++){
      i=order[o];
      if(P[i].ci!==last){ ctx.fillStyle=OPAQUE[P[i].ci]; last=P[i].ci; }
      ctx.globalAlpha=al3(qa(DEP[i]*TW[i]*0.22));
      ctx.beginPath(); ctx.arc(sx[i],sy[i],RAD[i]*2.4,0,6.283); ctx.fill();
    }
    // cœur brillant des particules
    ctx.globalCompositeOperation='source-over';
    last=-1;
    for(var o2=0;o2<N;o2++){
      i=order[o2];
      if(P[i].ci!==last){ ctx.fillStyle=OPAQUE[P[i].ci]; last=P[i].ci; }
      ctx.globalAlpha=al3(qa(DEP[i]*TW[i]+0.12));
      ctx.beginPath(); ctx.arc(sx[i],sy[i],RAD[i],0,6.283); ctx.fill();
    }
    // twinkles : flashs blancs intermittents, discrets (+ fine croix d'éclat)
    ctx.globalCompositeOperation='lighter';
    ctx.lineWidth=1;
    for(var o3=0;o3<N;o3++){
      i=order[o3];
      var v=Math.max(0,Math.sin(t*P[i].ts*1.3+P[i].tk));
      var v2=v*v, v4=v2*v2, v8=v4*v4, spk=v8*v8;      // v^16 sans Math.pow
      if(spk<0.4) continue;
      var dk=Math.max(0.3, Math.min(1,(ff[i]-0.74)/0.62));
      var rk=P[i].s*ff[i];
      ctx.fillStyle=OPAQUE_WHITE; ctx.globalAlpha=al3(qa(spk*0.5*dk));
      ctx.beginPath(); ctx.arc(sx[i],sy[i], rk*(0.7+spk*1.0),0,6.283); ctx.fill();
      var cl=rk*(1.6+spk*2.0);
      ctx.strokeStyle=OPAQUE_SPARK; ctx.globalAlpha=al3(qa(spk*0.28*dk));
      ctx.beginPath(); ctx.moveTo(sx[i]-cl,sy[i]); ctx.lineTo(sx[i]+cl,sy[i]); ctx.moveTo(sx[i],sy[i]-cl); ctx.lineTo(sx[i],sy[i]+cl); ctx.stroke();
    }
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='source-over';

    // --- BLOOM basse-résolution (rapide) : on floute une petite copie -------
    bctx.setTransform(1,0,0,1,0,0);
    bctx.clearRect(0,0,bw,bh);
    bctx.filter='blur(3px)';
    bctx.drawImage(canvas, 0,0, bw,bh);
    bctx.filter='none';
    ctx.save();
    ctx.globalCompositeOperation='lighter';
    ctx.globalAlpha=0.5;
    ctx.drawImage(bcanvas, 0,0,bw,bh, 0,0,W,H);   // on ne lit QUE la zone utile
    ctx.restore();

    // --- LOGO : rotation 360° eased + reflet synchronisé (options 1 & 2) ----
    var u=(t/LOGO_T)%1;                                   // tour normalisé
    var theta=6.28318*u - 0.42*Math.sin(2*6.28318*u);     // lent de face, file sur la tranche
    var tilt=0.14;
    logo.style.transform='translate(-50%,-50%) rotateX('+tilt.toFixed(3)+'rad) rotateY('+theta.toFixed(3)+'rad)';
    var faceN=Math.abs(Math.cos(theta));                  // 1 = face, 0 = tranche
    logoSheen.style.opacity=Math.pow(faceN,1.3).toFixed(3);
    logoSheen.style.backgroundPosition=(50 - 150*Math.sin(theta)).toFixed(1)+'% 0';

    if(visible) requestAnimationFrame(frame); else running=false;
  }

  size();
  // init sur la sphère/anneau
  var p0=scenes[0]; for(var j=0;j<N;j++){ P[j].x=p0[j][0]; P[j].y=p0[j][1]; P[j].z=p0[j][2]; }
  if(reduce){ scenes && (function(){ var pts=scenes[1]; for(var i=0;i<N;i++){P[i].x=pts[i][0];P[i].y=pts[i][1];P[i].z=pts[i][2];} })(); requestAnimationFrame(function(n){ frame(n); }); }
  else requestAnimationFrame(frame);

  // option 4 : couper l'animation quand le héros n'est plus visible
  if(!reduce && 'IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){
      visible=es[0].isIntersecting;
      if(visible){ if(!running){ running=true; requestAnimationFrame(frame); } }
      else if(!pausedAt) pausedAt=performance.now();
    }, { threshold:0.01 });
    io.observe(stage);
  }

  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt=setTimeout(size,180); });
})();
