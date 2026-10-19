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

  // ⚠️ FLUIDITÉ (19/10/2026) : l'animation est dessinée en WEBGL quand le navigateur le permet.
  // En Canvas 2D, chaque disque, chaque trait est un ordre de dessin séparé (jusqu'à ~4 500 par
  // image dans la phase « réseau »), que le processus GPU de Chrome traite un par un sur le MÊME fil
  // que l'assemblage de la page : mesuré 9 à 11 ms par image sur 16,7, d'où les images perdues dès
  // qu'on fait défiler. En WebGL, tout part en une douzaine d'ordres groupés. Le rendu reproduit
  // celui de Canvas 2D (bords lissés à la surface couverte, dégradés interpolés hors
  // prémultiplication et tramés, flou gaussien de la lueur, réduction et agrandissement
  // bilinéaires : étalonnés sur Chrome). Le code Canvas 2D d'origine reste en secours (pas de
  // WebGL, contexte perdu), inchangé. La lueur du logo est dessinée dans ce même rendu WebGL
  // (voir « LUEUR DU LOGO ») ; en secours, c'est la lueur CSS d'origine qui reste.
  var GLR = null, ctx = null, bcanvas = null, bctx = null;
  var lueurT0 = performance.now();   // l'animation CSS « morphglow » démarrait à la création du logo, juste au-dessus
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
  var WHITE = [255,250,239], SPARK = [255,244,224];

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
    canvas.width=W*dpr; canvas.height=H*dpr;
    if (ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    // PERF : la ZONE UTILE du tampon de bloom reste W*0,4 (216 px pour un stage de 540), mais le
    // tampon lui-même fait au moins 256x256 : en dessous de ce seuil, Chrome peut refuser
    // d'accelerer un canvas 2D, et lire dedans obligerait alors a rapatrier le canvas principal
    // du GPU vers le CPU a chaque image. Le rendu ne change pas : on ne lit que la zone utile.
    bw=Math.max(1,Math.round(W*BLOOM_SCALE)); bh=Math.max(1,Math.round(H*BLOOM_SCALE));
    if (bcanvas) { bcanvas.width=Math.max(256,bw); bcanvas.height=Math.max(256,bh); }
    cx=W/2; cy=H/2; R=Math.min(W,H)*0.44; rIn=Math.min(W,H)*0.24; D=R*3.4;
    scenes = META.map(function(m){ return m.b(); });
    buildGradients();
    if (GLR) GLR.taille();
  }

  // PERF : les dégradés du cœur étaient recréés à CHAQUE image (2,1 ms) et ceux des
  // 10 rayons aussi (1,6 ms). Ils ne dépendent que de la taille et de la pulsation :
  // on les construit une fois par redimensionnement, la pulsation étant échantillonnée
  // sur 32 pas (imperceptible à l'œil sur une respiration de plusieurs secondes).
  // Les mêmes valeurs (rayons, arrêts de couleur arrondis comme dans les chaînes rgba) servent
  // au rendu WebGL : gbVal / gcVal.
  var PULSE_STEPS = 32, gbCache = [], gcCache = [], gbVal = [], gcVal = [], rayGrad = null;
  var RAY_AL_MAX = 0.26;   // valeur maximale de l'opacité d'un rayon (0.08 + 0.18)
  var a3 = function(x){ return +x.toFixed(3); };
  function buildGradients(){
    gbCache = []; gcCache = []; gbVal = []; gcVal = [];
    for(var k=0;k<PULSE_STEPS;k++){
      var pulse = k/(PULSE_STEPS-1);
      var bR = R*(1.05 + 0.10*pulse), cR = R*(0.46 + 0.06*pulse);
      var gbS = [[0.00,255,242,220,a3(0.20+0.08*pulse)],[0.18,255,206,158,a3(0.13+0.06*pulse)],[0.55,207,133,95,0.05],[1.00,190,110,84,0]];
      var gcS = [[0.00,255,251,240,a3(0.48*(0.85+0.15*pulse))],[0.30,255,224,184,a3(0.30*(0.85+0.15*pulse))],[0.70,232,160,118,0.12],[1.00,207,133,95,0]];
      gbVal.push({ r:bR, s:gbS }); gcVal.push({ r:cR, s:gcS });
      if (!ctx) continue;
      var gb = ctx.createRadialGradient(cx,cy,0,cx,cy,bR);
      gbS.forEach(function(s){ gb.addColorStop(s[0],'rgba('+s[1]+','+s[2]+','+s[3]+','+s[4].toFixed(3)+')'); });
      gbCache.push({ g:gb, r:bR });
      var gc = ctx.createRadialGradient(cx,cy,0,cx,cy,cR);
      gcS.forEach(function(s){ gc.addColorStop(s[0],'rgba('+s[1]+','+s[2]+','+s[3]+','+s[4].toFixed(3)+')'); });
      gcCache.push({ g:gc, r:cR });
    }
    if (!ctx) return;
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
  // valeurs par particule calculées une seule fois par image (profondeur, scintillement, rayon,
  // éclat), partagées par les deux rendus
  var DEP=new Float64Array(N), TW=new Float64Array(N), RAD=new Float64Array(N);
  var SPK=new Float64Array(N), DK=new Float64Array(N), RK=new Float64Array(N);
  // connexions de la scène « réseau » de l'image en cours : x0, y0, x1, y1, opacité
  var LIG=new Float64Array(5*N*(N-1)/2), nLig=0;
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

    // connexions (cerveau / circuit) — distance 3D (invariante par rotation)
    nLig=0;
    if(meta.t==='net'){
      var th=R*0.42, th2=th*th;
      for(i=0;i<N;i++){ for(var k=i+1;k<N;k++){
        var dx=P[i].x-P[k].x, dy=P[i].y-P[k].y, dz=P[i].z-P[k].z, d2=dx*dx+dy*dy+dz*dz;
        if(d2>th2) continue;                                   // comparaison des carrés : pas de racine inutile
        var fa=(ff[i]+ff[k])*0.5;
        // Opacité : on reproduit EXACTEMENT l'arrondi à 3 décimales que faisait la chaîne
        // rgba(…, a.toFixed(3)) d'origine, pour un rendu identique au pixel près — mais sans
        // construire ni analyser la moindre chaîne (globalAlpha prend un nombre).
        var al=Math.round((1-Math.sqrt(d2)/th)*0.30*Math.min(1,fa)*1000)/1000;
        if(al<=0) continue;                                    // rien ne serait peint
        var o5=nLig*5; LIG[o5]=sx[i]; LIG[o5+1]=sy[i]; LIG[o5+2]=sx[k]; LIG[o5+3]=sy[k]; LIG[o5+4]=al; nLig++;
      } }
    }

    // PERF : profondeur, scintillement, rayon et éclat étaient recalculés À L'IDENTIQUE dans
    // plusieurs boucles (jusqu'à 400 sinus inutiles par image). On les calcule une fois.
    var dots=(meta.t==='dots'), mulR=(meta.t==='paint')?1.7:1;
    for(var pi=0;pi<N;pi++){
      var fp=ff[pi];
      DEP[pi]=Math.max(0.25, Math.min(1, (fp-0.74)/0.62));
      TW[pi]=dots?(0.6+0.4*Math.sin(t*2+P[pi].ph)):1;
      RAD[pi]=P[pi].s*fp*mulR;
      var v=Math.max(0,Math.sin(t*P[pi].ts*1.3+P[pi].tk));
      var v2=v*v, v4=v2*v2, v8=v4*v4, spk=v8*v8;      // v^16 sans Math.pow
      SPK[pi]=spk<0.4?0:spk;
      DK[pi]=Math.max(0.3, Math.min(1,(fp-0.74)/0.62));
      RK[pi]=P[pi].s*fp;
    }

    // --- LOGO : rotation 360° eased + reflet synchronisé (options 1 & 2) ----
    var u=(t/LOGO_T)%1;                                   // tour normalisé
    var theta=6.28318*u - 0.42*Math.sin(2*6.28318*u);     // lent de face, file sur la tranche
    var tilt=0.14;

    var pulse = 0.5 + 0.5*Math.sin(t*1.7);
    var pk = (pulse*(PULSE_STEPS-1) + 0.5)|0;
    // la lueur du logo (rendu WebGL) se pose avec l'angle EXACT de la transformation CSS (arrondi compris)
    if (GLR) GLR.dessiner(t, pk, now - lueurT0, +theta.toFixed(3)); else dessiner2D(t, pk);

    logo.style.transform='translate(-50%,-50%) rotateX('+tilt.toFixed(3)+'rad) rotateY('+theta.toFixed(3)+'rad)';
    var faceN=Math.abs(Math.cos(theta));                  // 1 = face, 0 = tranche
    logoSheen.style.opacity=Math.pow(faceN,1.3).toFixed(3);
    logoSheen.style.backgroundPosition=(50 - 150*Math.sin(theta)).toFixed(1)+'% 0';

    if(visible) requestAnimationFrame(frame); else running=false;
  }

  // ---------------------------------------------------------------------------
  // RENDU CANVAS 2D (secours) : le code d'origine, opération pour opération.
  // ---------------------------------------------------------------------------
  function dessiner2D(t, pk){
    var i;
    ctx.clearRect(0,0,W,H);

    // --- NOYAU DE GALAXIE : halo lumineux qui palpite derrière le logo ------
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

    // connexions (cerveau / circuit)
    // ⚠️ PERF, CONTRE-INTUITIF — NE PAS « OPTIMISER » EN REGROUPANT LES LIGNES :
    // regrouper les ~4 000 segments en ~70 tracés (un par teinte) semble malin, mais c'est
    // SEPT FOIS PLUS LENT. Mesuré sur le vrai canvas 990×990 (médiane de 7 séries entrelacées) :
    //   un stroke() par ligne + globalAlpha ......  3,3 ms   ← retenu
    //   un stroke() par ligne + chaîne rgba() ....  5,0 ms
    //   un seul stroke() pour tout ............... 30,7 ms
    //   regroupé par teinte (~70 tracés) ......... 36,2 ms
    // Un chemin à nombreux sous-chemins force un rendu lent, alors que des segments isolés
    // empruntent un chemin optimisé. (Revérifié le 19/10/2026 sur le processus GPU : regroupées
    // par opacité, les lignes y coûtent 17,8 ms par image au lieu de 9,3.)
    if(nLig){
      ctx.lineWidth=1; ctx.strokeStyle=OPAQUE[0];              // COLORS[0] = l'accent #be6e54
      for(var li=0;li<nLig;li++){
        var o5=li*5;
        ctx.globalAlpha=LIG[o5+4];
        ctx.beginPath(); ctx.moveTo(LIG[o5],LIG[o5+1]); ctx.lineTo(LIG[o5+2],LIG[o5+3]); ctx.stroke();
      }
      ctx.globalAlpha=1;
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
      var spk=SPK[i];
      if(!spk) continue;
      var dk=DK[i], rk=RK[i];
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
  }

  // ---------------------------------------------------------------------------
  // RENDU WEBGL : mêmes primitives, mêmes couleurs, mêmes modes de fusion, même ordre.
  // ---------------------------------------------------------------------------
  // Toutes les coordonnées sont en pixels de l'appareil, origine en haut à gauche.
  // Les couleurs sont prémultipliées (comme un canvas 2D) ; « lighter » = ONE, ONE ;
  // « source-over » = ONE, ONE_MINUS_SRC_ALPHA. Les bords sont lissés d'après la distance au bord,
  // sur un pixel (couverture 0,5 au bord), comme le rendu accéléré de Chrome (étalonné : disques,
  // traits horizontaux et obliques, croisement de traits d'un même tracé = couverture maximale).
  function creerRenduGL(cv){
    var gl;
    try { gl = cv.getContext('webgl', { alpha:true, premultipliedAlpha:true, antialias:false, depth:false, stencil:false, preserveDrawingBuffer:false }); } catch(e) { gl = null; }
    if (!gl) return null;
    var ext = gl.getExtension('ANGLE_instanced_arrays');
    if (!ext) return 'perdu';
    var hp = gl.getShaderPrecisionFormat && gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    var PREC = (hp && hp.precision > 0) ? 'precision highp float;\n' : 'precision mediump float;\n';
    var CLIP = 'uniform vec2 u_res;\nvec4 clip(vec2 p){ return vec4(p.x/u_res.x*2.0-1.0, 1.0-p.y/u_res.y*2.0, 0.0, 1.0); }\n';
    // tramage des dégradés, comme Chrome (Skia) : matrice ordonnée 8x8 dont l'indice entrelace les bits
    // de x et de y (y0 x0 y1 x1 y2 x2), valeur M*2/128 - 63/128, en 1/255 ; retrouvée sur le rendu de
    // Chrome. Coordonnées de l'image (origine en haut à gauche) : u_hy = hauteur de la cible.
    var TRAME = 'uniform float u_hy;\n' +
      'vec4 tramer(vec4 c){ vec2 p=vec2(floor(gl_FragCoord.x), u_hy-1.0-floor(gl_FragCoord.y));' +
      ' vec2 b0=mod(p,2.0), b1=mod(floor(p*0.5),2.0), b2=mod(floor(p*0.25),2.0);' +
      ' float m=32.0*b0.y+16.0*b0.x+8.0*b1.y+4.0*b1.x+2.0*b2.y+b2.x;' +
      ' c.rgb=clamp(c.rgb+(m*(2.0/128.0)-63.0/128.0)/255.0, 0.0, c.a); return c; }\n';
    var VS_PLEIN = 'attribute vec2 q; void main(){ gl_Position=vec4(q,0.0,1.0); }';
    var SRC = {
      // disques pleins (halos, cœurs, éclats) : une instance = centre, rayon, couleur prémultipliée
      disque: ['attribute vec2 q; attribute vec4 c; attribute vec4 col; varying vec2 l; varying float r; varying vec4 vc;\n' + CLIP +
        'void main(){ float e=c.z+1.0; l=q*e; r=c.z; vc=col; gl_Position=clip(c.xy+l); }',
        // ⚠️ « couture » : l'arc d'origine va de 0 à 6,283 (un peu moins que 2π) ; Chrome le referme par
        // une corde minuscule, traitée comme un bord vertical passant par le point le plus à droite du
        // disque. Ce bord multiplie la couverture de la dernière colonne de pixels (étalonné sur 54 disques).
        'varying vec2 l; varying float r; varying vec4 vc;\nvoid main(){ gl_FragColor=vc*(clamp(0.5+r-length(l),0.0,1.0)*clamp(0.5+r-l.x,0.0,1.0)); }'],
      // traits (connexions) : extrémités coupées net, largeur w
      trait: ['attribute vec2 q; attribute vec4 s; attribute float w; attribute vec4 col; varying vec3 m; varying float hw; varying vec4 vc;\n' + CLIP +
        'void main(){ vec2 d=s.zw-s.xy; float L=length(d); vec2 u=L>0.0?d/L:vec2(1.0,0.0); vec2 n=vec2(-u.y,u.x);' +
        ' float a=q.x*(L+2.0)-1.0, b=q.y*(w*0.5+1.0); m=vec3(a,b,L); hw=w*0.5; vc=col; gl_Position=clip(s.xy+u*a+n*b); }',
        'varying vec3 m; varying float hw; varying vec4 vc;\nvoid main(){ float k=min(min(clamp(0.5+m.x,0.0,1.0),clamp(0.5+m.z-m.x,0.0,1.0)),clamp(0.5+hw-abs(m.y),0.0,1.0)); gl_FragColor=vc*k; }'],
      // croix d'éclat : deux bras d'un même tracé (au croisement, la couverture est la plus forte des deux)
      croix: ['attribute vec2 q; attribute vec4 c; attribute vec4 col; varying vec2 l; varying vec2 g; varying vec4 vc;\n' + CLIP +
        'void main(){ float e=c.z+1.0; l=q*e; g=c.zw; vc=col; gl_Position=clip(c.xy+l); }',
        'varying vec2 l; varying vec2 g; varying vec4 vc; uniform float u_s;\nvoid main(){ vec2 a=abs(l);' +
        ' float h=min(clamp(0.5+g.x-a.x,0.0,1.0),clamp(0.5+g.y-a.y,0.0,1.0)); float v=min(clamp(0.5+g.y-a.x,0.0,1.0),clamp(0.5+g.x-a.y,0.0,1.0));' +
        ' gl_FragColor=vc*mix(max(h,v),h+v,u_s); }'],
      // disque à dégradé radial (grand bloom, cœur) : 4 arrêts, interpolés HORS prémultiplication
      radial: ['attribute vec2 q; uniform vec3 u_c; varying vec2 l; varying float rr;\n' + CLIP +
        'void main(){ float e=u_c.z+1.0; l=q*e; rr=u_c.z; gl_Position=clip(u_c.xy+l); }',
        'varying vec2 l; varying float rr; uniform vec4 u_o; uniform vec4 u_k0; uniform vec4 u_k1; uniform vec4 u_k2; uniform vec4 u_k3;\n' + TRAME +
        'void main(){ float d=length(l); float t=clamp(d/rr,0.0,1.0); vec4 k;' +
        ' if(t<=u_o.y) k=mix(u_k0,u_k1,(t-u_o.x)/(u_o.y-u_o.x)); else if(t<=u_o.z) k=mix(u_k1,u_k2,(t-u_o.y)/(u_o.z-u_o.y)); else k=mix(u_k2,u_k3,(t-u_o.z)/(u_o.w-u_o.z));' +
        ' gl_FragColor=tramer(vec4(k.rgb*k.a,k.a))*(clamp(0.5+rr-d,0.0,1.0)*clamp(0.5+rr-l.x,0.0,1.0)); }'],
      // rayons : quadrilatère (0,-1)(1,-0.1)(1,0.1)(0,1) étiré par une transformation affine, dégradé 0→1
      rayon: ['attribute vec2 q; attribute vec4 m1; attribute vec4 m2; varying float gx; varying vec4 de; varying float ga;\n' + CLIP +
        'vec2 tr(vec2 p){ return vec2(m1.x*p.x+m1.z*p.y+m2.x, m1.y*p.x+m1.w*p.y+m2.y); }\n' +
        'float dist(vec2 a, vec2 b, vec2 p){ vec2 e=b-a; return (e.x*(p.y-a.y)-e.y*(p.x-a.x))/length(e); }\n' +
        'void main(){ float ex=1.0/length(m1.xy), ey=1.0/length(m1.zw);' +
        ' vec2 u=vec2(mix(-ex,1.0+ex,q.x), mix(-1.0-ey,1.0+ey,q.y)); vec2 p=tr(u);' +
        ' vec2 A=tr(vec2(0.0,-1.0)), B=tr(vec2(1.0,-0.1)), C=tr(vec2(1.0,0.1)), E=tr(vec2(0.0,1.0));' +
        ' de=vec4(dist(A,B,p),dist(B,C,p),dist(C,E,p),dist(E,A,p)); gx=u.x; ga=m2.z; gl_Position=clip(p); }',
        'varying float gx; varying vec4 de; varying float ga;\n' + TRAME +
        'void main(){ vec4 c4=clamp(0.5+de,0.0,1.0); float k=c4.x*c4.y*c4.z*c4.w; float t=clamp(gx,0.0,1.0);' +
        ' vec4 a=vec4(255.0,242.0,218.0,0.26*255.0)/255.0, b=vec4(255.0,206.0,158.0,0.117*255.0)/255.0, d=vec4(255.0,190.0,140.0,0.0)/255.0;' +
        ' vec4 g=t<=0.45?mix(a,b,t/0.45):mix(b,d,(t-0.45)/0.55); gl_FragColor=tramer(vec4(g.rgb*g.a,g.a)*ga)*k; }'],
      // LUEUR DU LOGO (voir lueurTaille) : réduction 4 x 4, flou gaussien séparable, alpha cumulé, ombres
      lreduire: [VS_PLEIN, 'uniform sampler2D u_t; uniform vec2 u_dst; uniform vec2 u_k;\n' +
        'void main(){ vec2 c=gl_FragCoord.xy/u_dst; vec4 s=vec4(0.0); for(int i=0;i<4;i++) for(int j=0;j<4;j++){ s+=texture2D(u_t,c+(vec2(float(i),float(j))-1.5)*u_k); } gl_FragColor=s/16.0; }'],
      // (poids calculés ici plutôt qu'en tableau uniforme : 25 flottants dépasseraient la limite minimale de
      // WebGL, 16 vecteurs, sur les appareils les plus modestes)
      lflou: [VS_PLEIN, 'uniform sampler2D u_t; uniform vec2 u_px; uniform vec2 u_dir; uniform float u_k; uniform float u_norm; uniform int u_n;\n' +
        'void main(){ vec2 p=floor(gl_FragCoord.xy)+0.5; float s=texture2D(u_t,p*u_px).a;' +
        ' for(int i=1;i<25;i++){ if(i>u_n) break; vec2 o=u_dir*float(i); s+=(texture2D(u_t,(p+o)*u_px).a+texture2D(u_t,(p-o)*u_px).a)*exp(-float(i*i)*u_k); }' +
        ' gl_FragColor=vec4(s*u_norm); }'],
      lcumul: [VS_PLEIN, 'uniform sampler2D u_a; uniform sampler2D u_b; uniform vec2 u_dst; uniform float u_k;\n' +
        'void main(){ vec2 c=gl_FragCoord.xy/u_dst; float a=texture2D(u_a,c).a, b=texture2D(u_b,c).a; gl_FragColor=vec4(a+u_k*b*(1.0-a)); }'],
      lfinale: [VS_PLEIN, 'uniform sampler2D u_ta; uniform sampler2D u_tb; uniform sampler2D u_tc; uniform vec2 u_dst; uniform vec4 u_ca; uniform vec4 u_cb; uniform vec4 u_cc; uniform float u_dy;\n' +
        'void main(){ vec2 c=gl_FragCoord.xy/u_dst; vec4 sa=u_ca*texture2D(u_ta,c).a, sb=u_cb*texture2D(u_tb,c).a, sc=u_cc*texture2D(u_tc,c+vec2(0.0,u_dy)).a;' +
        ' vec4 bc=sb+sc*(1.0-sb.a); gl_FragColor=sa+bc*(1.0-sa.a); }'],
      // la lueur posée sous le logo : carré de côté u_S centré sur le stage, tourné comme le logo (CSS : rotateX(a)
      // rotateY(b), u_r = cos b, sin b, cos a, sin a ; y vers le bas), perspective u_d du stage (1100 px) depuis son
      // centre ; w transmis pour une interpolation correcte en perspective. Deux niveaux précalculés, mélangés.
      lpose: ['attribute vec2 q; uniform vec2 u_wh; uniform float u_S; uniform vec4 u_r; uniform float u_d; varying vec2 uv;\n' +
        'void main(){ vec2 l=q*(u_S*0.5); float x=l.x*u_r.x, y=l.y*u_r.z+l.x*u_r.y*u_r.w, z=l.y*u_r.w-l.x*u_r.y*u_r.z;' +
        ' float w=1.0-z/u_d; vec2 p=u_wh*0.5+vec2(x,y)/w; gl_Position=vec4((p.x/u_wh.x*2.0-1.0)*w,(1.0-p.y/u_wh.y*2.0)*w,0.0,w);' +
        ' uv=vec2(q.x*0.5+0.5,0.5-q.y*0.5); }',
        'varying vec2 uv; uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_f;\nvoid main(){ gl_FragColor=mix(texture2D(u_a,uv),texture2D(u_b,uv),u_f); }'],
      // passes plein écran : copie, réduction, flou, agrandissement
      plein: [VS_PLEIN,
        'uniform sampler2D u_t; uniform vec2 u_dst; uniform float u_a;\nvoid main(){ gl_FragColor=texture2D(u_t, gl_FragCoord.xy/u_dst)*u_a; }'],
      flou: [VS_PLEIN,
        'uniform sampler2D u_t; uniform vec2 u_px; uniform vec2 u_dir; uniform vec2 u_n; uniform float u_w[10];\n' +
        'vec4 lire(vec2 p){ if(p.x<0.0||p.y<0.0||p.x>=u_n.x||p.y>=u_n.y) return vec4(0.0); return texture2D(u_t,(p+0.5)*u_px); }\n' +
        'void main(){ vec2 p=floor(gl_FragCoord.xy); vec4 s=lire(p)*u_w[0];' +
        ' for(int i=1;i<10;i++){ vec2 o=u_dir*float(i); s+=(lire(p+o)+lire(p-o))*u_w[i]; } gl_FragColor=s; }']
    };
    function prog(nom){
      var s = SRC[nom], p = gl.createProgram();
      [[gl.VERTEX_SHADER, s[0]], [gl.FRAGMENT_SHADER, PREC + s[1]]].forEach(function(x){
        var sh = gl.createShader(x[0]); gl.shaderSource(sh, x[1]); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(nom + ' : ' + gl.getShaderInfoLog(sh));
        gl.attachShader(p, sh);
      });
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(nom + ' : ' + gl.getProgramInfoLog(p));
      var o = { p:p, a:{}, u:{} }, n, i2;
      n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); for (i2=0;i2<n;i2++){ var at=gl.getActiveAttrib(p,i2); o.a[at.name]=gl.getAttribLocation(p,at.name); }
      n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (i2=0;i2<n;i2++){ var un=gl.getActiveUniform(p,i2); var nm=un.name.replace(/\[0\]$/,''); o.u[nm]=gl.getUniformLocation(p,un.name); }
      return o;
    }
    var PR;
    try { PR = {}; for (var nom in SRC) PR[nom] = prog(nom); } catch(e) { return 'perdu'; }
    var bufQ = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufQ);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    var bufQ01 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufQ01);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,-1, 1,-1, 0,1, 1,1]), gl.STATIC_DRAW);
    var bufQR = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufQR);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 1,1]), gl.STATIC_DRAW);
    var bufI = gl.createBuffer();
    var data = new Float32Array(4096 * 9);
    function place(n9){ if (data.length < n9) { var d = new Float32Array(Math.max(n9, data.length * 2)); data = d; } }
    // poids du flou gaussien d'écart-type 3 px (rayon 9), normalisés : comme filter:blur(3px)
    var POIDS = (function(){ var w=[], s=0, k; for(k=0;k<10;k++){ w[k]=Math.exp(-k*k/18); s+=(k?2:1)*w[k]; } for(k=0;k<10;k++) w[k]/=s; return new Float32Array(w); })();
    // textures de travail : la scène (taille du canvas), puis la lueur réduite (deux, pour le flou)
    function cible(w, h){
      var tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx, 0);
      return { tx:tx, fb:fb, w:w, h:h };
    }
    var SC = null, B1 = null, B2 = null;
    function liberer(o){ if (o) { gl.deleteTexture(o.tx); gl.deleteFramebuffer(o.fb); } }
    function taille(){
      liberer(SC); liberer(B1); liberer(B2);
      SC = cible(canvas.width, canvas.height); B1 = cible(bw, bh); B2 = cible(bw, bh);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      lueurTaille();
    }
    // ---- LUEUR DU LOGO, recalculée ici (remplace la lueur CSS « morphglow ») --------------------------------
    // ⚠️ FLUIDITÉ (19/10/2026) : la lueur CSS (trois drop-shadow animés sur le logo qui tourne) obligeait le
    // navigateur à refaire trois grands flous, à pleine définition, à CHAQUE image : sur un écran 3840 x 2400
    // (densité 2,5, puce Intel), dans une vraie fenêtre, 42 images/s au lieu de 60, même sans défiler. Les mêmes
    // trois ombres sont calculées ici sur de petites textures (le flou les rend lisses), puis posées dans CE canvas,
    // sous le logo, avec la même rotation et la même perspective que lui (formules de CSS Transforms). Un canvas à
    // part, tourné par CSS, était plus simple mais coûtait ~1,2 ms par image à l'assemblage de la page.
    // La lueur ne dépend que de l'instant de sa pulsation : ses trois ombres varient ensemble selon un seul
    // paramètre m entre les deux images clés. Elle est calculée pour LUEUR_NIV valeurs de m, une seule fois (au fil
    // des premières images), puis chaque image mélange les deux niveaux voisins.
    // Reproduit : la chaîne des ombres (chacune se calcule sur le résultat de la précédente), leurs images clés et
    // leur courbe (ease-in-out sur chaque moitié, couleurs interpolées prémultipliées), l'écart-type (la longueur
    // d'un drop-shadow EST l'écart-type, mesuré). Écarts volontaires, mesurés invisibles : le reflet qui balaie le
    // logo renforçait très légèrement la lueur d'origine (il fait partie du groupe filtré), et l'extrême bord de la
    // lueur est coupé au bord du canvas. Le logo garde une ombre nulle (site.css) : sans aucun filtre, le navigateur
    // le dessinerait un peu plus net qu'avant aux densités faibles.
    // Pas de lueur ici en « réduire les animations » (la lueur CSS y est déjà coupée) ; si la lecture de l'image du
    // logo est refusée, ou si le contexte est perdu, la classe « lueur-gl » est retirée et la lueur CSS revient.
    var LUEUR_MARGE = 200, LUEUR_NIV = 24;                    // px CSS autour de la boîte du logo ; niveaux
    var LTAU_OUT = 3, LTAU_A = 4, LTAU_B = 10, LTAU_C = 8;      // px CSS par texel : lueur posée, ombres A, B, C
    var LT = {}, LCA = [], lS = 1, lPret = false, lAttend = false, lProchain = 0, lHS = reduce;
    var LK0 = [[0,16,255,226,189,0.85], [0,38,255,200,150,0.6], [8,26,190,110,84,0.45]];   // images clés 0 % / 100 %
    var LK1 = [[0,28,255,238,210,1], [0,66,255,205,155,0.95], [10,30,190,110,84,0.55]];    // et 50 % : [dy, σ, r, g, b, a]
    if (!lHS) stage.classList.add('lueur-gl');                // coupe la lueur CSS (site.css)
    function lueurHS(){ lHS = true; lPret = false; stage.classList.remove('lueur-gl'); }
    function lueurTaille(){
      lPret = false;
      if (lHS) return;
      if (!(logoImg.complete && logoImg.naturalWidth)) {
        if (!lAttend) { lAttend = true; logoImg.addEventListener('load', function(){ lAttend = false; if (!gl.isContextLost()) lueurTaille(); }, { once:true }); }
        return;
      }
      var box = W * 0.46; lS = box + 2 * LUEUR_MARGE;
      for (var n in LT) liberer(LT[n]); LT = {};
      LCA.forEach(liberer); LCA = new Array(LUEUR_NIV); lProchain = 0;
      var na = Math.max(1, Math.round(lS / LTAU_A)), nb = Math.max(1, Math.round(lS / LTAU_B)), nc = Math.max(1, Math.round(lS / LTAU_C));
      // silhouette : le logo tel que l'écran le dessine (densité réelle), réduit à la résolution A par le lissage
      // du navigateur, centré, marges vides
      var dat;
      try {
        var bd = Math.max(1, Math.round(box * (window.devicePixelRatio || 1)));
        var c1 = document.createElement('canvas'); c1.width = bd; c1.height = bd;
        var x1 = c1.getContext('2d'); x1.imageSmoothingEnabled = true; x1.imageSmoothingQuality = 'high';
        x1.drawImage(logoImg, 0, 0, bd, bd);
        var bp = box / lS * na, o0 = (na - bp) / 2;
        var c2 = document.createElement('canvas'); c2.width = na; c2.height = na;
        var x2 = c2.getContext('2d', { willReadFrequently:true }); x2.imageSmoothingEnabled = true; x2.imageSmoothingQuality = 'high';
        x2.drawImage(c1, o0, o0, bp, bp);
        var m1 = x2.getImageData(0, 0, na, na).data;
        dat = new Uint8Array(na * na * 4);
        for (var y = 0; y < na; y++) for (var x = 0; x < na; x++) dat[((na - 1 - y) * na + x) * 4 + 3] = m1[(y * na + x) * 4 + 3];   // ligne 0 en bas
      } catch(e) { lueurHS(); return; }
      LT.a0 = cible(na, na);
      gl.bindTexture(gl.TEXTURE_2D, LT.a0.tx); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, na, na, 0, gl.RGBA, gl.UNSIGNED_BYTE, dat);
      LT.ta = cible(na, na); LT.ba = cible(na, na); LT.a1 = cible(na, na);
      LT.a1b = cible(nb, nb); LT.tb = cible(nb, nb); LT.bb = cible(nb, nb);
      LT.a2 = cible(nc, nc); LT.tc = cible(nc, nc); LT.bc = cible(nc, nc);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      lPret = true;
    }
    // courbe CSS ease-in-out = cubic-bezier(0.42, 0, 0.58, 1)
    function lBezier(x){
      var t = x, cx2 = 1.26, bx = 3*(0.58-0.42)-cx2, ax = 1-cx2-bx, by = 3, ay = 1-by;
      for (var k=0;k<8;k++){ var xt = ((ax*t+bx)*t+cx2)*t-x, d = (3*ax*t+2*bx)*t+cx2; if (Math.abs(xt) < 1e-7 || !d) break; t -= xt/d; }
      t = Math.min(1, Math.max(0, t)); return (ay*t+by)*t*t;
    }
    function lPasse(pr, dst){ gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); gl.useProgram(pr.p); attributs(pr, [['q',2,0,0,bufQ]], 0); }
    function lTex(unite, t2, u){ gl.activeTexture(gl.TEXTURE0 + unite); gl.bindTexture(gl.TEXTURE_2D, t2 ? t2.tx : null); if (u) gl.uniform1i(u, unite); }
    // flou gaussien d'écart-type sig texels (rayon 3 sig, au plus 24), poids normalisés
    function lFlou(src, tmp, dst, sig){
      var pr = PR.lflou, n = Math.min(24, Math.ceil(3*sig)), k = 1/(2*sig*sig), s = 1;
      for (var i=1;i<=n;i++) s += 2*Math.exp(-i*i*k);
      lPasse(pr, tmp); lTex(0, src, pr.u.u_t);
      gl.uniform2f(pr.u.u_px, 1/src.w, 1/src.h); gl.uniform2f(pr.u.u_dir, 1, 0); gl.uniform1f(pr.u.u_k, k); gl.uniform1f(pr.u.u_norm, 1/s); gl.uniform1i(pr.u.u_n, n);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lPasse(pr, dst); lTex(0, tmp, pr.u.u_t);
      gl.uniform2f(pr.u.u_dir, 0, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    // la lueur complète pour m = k / (LUEUR_NIV - 1), calculée une seule fois
    function lueurNiveau(k){
      if (LCA[k]) return LCA[k];
      var m = k / (LUEUR_NIV - 1), E = [], i, pr;
      for (i=0;i<3;i++){
        var a = LK0[i], b = LK1[i];
        E.push({ dy: a[0]+(b[0]-a[0])*m, s: a[1]+(b[1]-a[1])*m, al: a[5]+(b[5]-a[5])*m,
          r: (a[2]*a[5]+(b[2]*b[5]-a[2]*a[5])*m)/255, g: (a[3]*a[5]+(b[3]*b[5]-a[3]*a[5])*m)/255, bl: (a[4]*a[5]+(b[4]*b[5]-a[4]*a[5])*m)/255 });
      }
      gl.disable(gl.BLEND);
      lTex(1, null); lTex(2, null);                       // aucune texture de travail laissée sur une autre unité
      // ombre A, alpha après A, réduit pour B
      lFlou(LT.a0, LT.ta, LT.ba, E[0].s / LTAU_A);
      pr = PR.lcumul; lPasse(pr, LT.a1); lTex(0, LT.a0, pr.u.u_a); lTex(1, LT.ba, pr.u.u_b);
      gl.uniform2f(pr.u.u_dst, LT.a1.w, LT.a1.h); gl.uniform1f(pr.u.u_k, E[0].al);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      pr = PR.lreduire; lPasse(pr, LT.a1b); lTex(0, LT.a1, pr.u.u_t);
      gl.uniform2f(pr.u.u_dst, LT.a1b.w, LT.a1b.h); gl.uniform2f(pr.u.u_k, 0.25/LT.a1b.w, 0.25/LT.a1b.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // ombre B, alpha après B (à la résolution de C)
      lFlou(LT.a1b, LT.tb, LT.bb, E[1].s / LTAU_B);
      pr = PR.lcumul; lPasse(pr, LT.a2); lTex(0, LT.a1, pr.u.u_a); lTex(1, LT.bb, pr.u.u_b);
      gl.uniform2f(pr.u.u_dst, LT.a2.w, LT.a2.h); gl.uniform1f(pr.u.u_k, E[1].al);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lTex(1, null);
      // ombre C, puis la lueur entière dans le niveau
      lFlou(LT.a2, LT.tc, LT.bc, E[2].s / LTAU_C);
      var no = Math.max(1, Math.round(lS / LTAU_OUT)), c = LCA[k] = cible(no, no);
      pr = PR.lfinale; lPasse(pr, c); lTex(0, LT.ba, pr.u.u_ta); lTex(1, LT.bb, pr.u.u_tb); lTex(2, LT.bc, pr.u.u_tc);
      gl.uniform2f(pr.u.u_dst, c.w, c.h);
      gl.uniform4f(pr.u.u_ca, E[0].r, E[0].g, E[0].bl, E[0].al);
      gl.uniform4f(pr.u.u_cb, E[1].r, E[1].g, E[1].bl, E[1].al);
      gl.uniform4f(pr.u.u_cc, E[2].r, E[2].g, E[2].bl, E[2].al);
      gl.uniform1f(pr.u.u_dy, E[2].dy / lS);          // vers le bas = coordonnée de texture plus haute
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lTex(1, null); lTex(2, null);
      return c;
    }
    // pose la lueur de l'instant tl (ms depuis le début de l'animation CSS) sous un logo tourné de th radians
    function lueurPoser(tl, th){
      var p = ((tl % 4000) + 4000) % 4000 / 4000, m = p < 0.5 ? lBezier(p*2) : 1 - lBezier(p*2 - 1);
      var x = m * (LUEUR_NIV - 1), k0 = Math.min(LUEUR_NIV - 2, Math.floor(x));
      var a = lueurNiveau(k0), b = lueurNiveau(k0 + 1);
      while (lProchain < LUEUR_NIV && LCA[lProchain]) lProchain++;
      if (lProchain < LUEUR_NIV) lueurNiveau(lProchain); // le reste du cache se remplit au fil des premières images
      var pr = PR.lpose;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, SC.w, SC.h);
      gl.useProgram(pr.p); attributs(pr, [['q',2,0,0,bufQ]], 0); fusion(SRCOVER);
      lTex(0, a, pr.u.u_a); lTex(1, b, pr.u.u_b); gl.uniform1f(pr.u.u_f, x - k0);
      gl.uniform2f(pr.u.u_wh, W, H); gl.uniform1f(pr.u.u_S, lS); gl.uniform1f(pr.u.u_d, 1100);
      gl.uniform4f(pr.u.u_r, Math.cos(th), Math.sin(th), Math.cos(0.14), Math.sin(0.14));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      lTex(1, null); gl.activeTexture(gl.TEXTURE0);
    }

    var actifs = [];
    function attributs(pr, liste, stride){
      // liste : [nom, taille, décalage, diviseur, tampon]
      actifs.forEach(function(l){ gl.disableVertexAttribArray(l); ext.vertexAttribDivisorANGLE(l, 0); }); actifs = [];
      liste.forEach(function(a){
        var l = pr.a[a[0]]; if (l === undefined || l < 0) return;
        gl.bindBuffer(gl.ARRAY_BUFFER, a[4]); gl.enableVertexAttribArray(l);
        gl.vertexAttribPointer(l, a[1], gl.FLOAT, false, a[4] === bufI ? stride : 0, a[2]);
        ext.vertexAttribDivisorANGLE(l, a[3]); actifs.push(l);
      });
    }
    function envoyer(n, stride){ gl.bindBuffer(gl.ARRAY_BUFFER, bufI); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * stride / 4), gl.STREAM_DRAW); }
    var LIGHTER = 1, SRCOVER = 2;
    // Traits de 1 px (lineWidth 1) : quand leur largeur à l'écran ne dépasse pas 1 pixel (densité ≤ 1), Chrome les
    // trace en « fil » (hairline) : 1 pixel de large, opacité multipliée par la largeur, et les deux bras d'une croix
    // s'additionnent à leur croisement (deux segments distincts). Au-delà, trait plein : au croisement, la plus forte
    // des deux couvertures. Dans les deux cas, aux coins (bouts des traits), la plus faible des couvertures.
    var FIL = dpr <= 1, FIL_A = FIL ? dpr : 1;
    function fusion(m){ gl.enable(gl.BLEND); if (m === LIGHTER) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    // disques : (cx, cy, r, 0, couleur prémultipliée), en pixels de l'appareil
    function disques(n, mode){
      if (!n) return;
      var pr = PR.disque; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_res, SC.w, SC.h); envoyer(n, 32); fusion(mode);
      attributs(pr, [['q',2,0,0,bufQ],['c',4,0,1,bufI],['col',4,16,1,bufI]], 32);
      ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, n);
    }
    function radial(v){
      var pr = PR.radial, s = v.s; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_res, SC.w, SC.h); gl.uniform1f(pr.u.u_hy, SC.h); fusion(LIGHTER);
      gl.uniform3f(pr.u.u_c, cx*dpr, cy*dpr, v.r*dpr); gl.uniform4f(pr.u.u_o, s[0][0], s[1][0], s[2][0], s[3][0]);
      ['u_k0','u_k1','u_k2','u_k3'].forEach(function(k, j){ gl.uniform4f(pr.u[k], s[j][1]/255, s[j][2]/255, s[j][3]/255, s[j][4]); });
      attributs(pr, [['q',2,0,0,bufQ]], 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function dessiner(t, pk, tl, th){
      var i, o, n, j;
      gl.bindFramebuffer(gl.FRAMEBUFFER, SC.fb); gl.viewport(0, 0, SC.w, SC.h);
      gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      // noyau : grand bloom diffus, cœur chaud (additifs)
      radial(gbVal[pk]); radial(gcVal[pk]);
      var coreR = gcVal[pk].r;
      // rayons (additifs) : transformation translate(cx,cy) rotate(a) scale(L,wd), à la densité près
      n = 0;
      for (var ri=0; ri<RAYS.length; ri++){
        var rj=RAYS[ri];
        var beat=Math.max(0,Math.sin(t*rj.sp+rj.ph));
        var L = coreR*rj.len*(0.5+0.5*beat), wd = R*rj.w*(0.7+0.3*beat), an = rj.a + t*rj.rot;
        var ca = Math.cos(an), sa = Math.sin(an); o = n*8;
        data[o]=ca*L*dpr; data[o+1]=sa*L*dpr; data[o+2]=-sa*wd*dpr; data[o+3]=ca*wd*dpr;
        data[o+4]=cx*dpr; data[o+5]=cy*dpr; data[o+6]=(0.08+0.18*beat)/RAY_AL_MAX; data[o+7]=0; n++;
      }
      var pr = PR.rayon; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_res, SC.w, SC.h); gl.uniform1f(pr.u.u_hy, SC.h); envoyer(n, 32); fusion(LIGHTER);
      attributs(pr, [['q',2,0,0,bufQR],['m1',4,0,1,bufI],['m2',4,16,1,bufI]], 32);
      ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, n);
      // connexions (source-over), dans l'ordre de la boucle d'origine
      if (nLig){
        place(nLig * 9);
        var c0 = COLORS[0], w = FIL ? 1 : 1*dpr;
        for (j=0;j<nLig;j++){ var o5=j*5, al=LIG[o5+4]*FIL_A; o=j*9;
          data[o]=LIG[o5]*dpr; data[o+1]=LIG[o5+1]*dpr; data[o+2]=LIG[o5+2]*dpr; data[o+3]=LIG[o5+3]*dpr; data[o+4]=w;
          data[o+5]=c0[0]/255*al; data[o+6]=c0[1]/255*al; data[o+7]=c0[2]/255*al; data[o+8]=al; }
        pr = PR.trait; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_res, SC.w, SC.h); envoyer(nLig, 36); fusion(SRCOVER);
        attributs(pr, [['q',2,0,0,bufQ01],['s',4,0,1,bufI],['w',1,16,1,bufI],['col',4,20,1,bufI]], 36);
        ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, nLig);
      }
      // halos (additifs) puis cœurs des particules (source-over, du fond vers l'avant)
      place(N * 8);
      for (var pass=0; pass<2; pass++){
        for (j=0;j<N;j++){ i=order[j]; var c=P[i].c, a=pass ? al3(qa(DEP[i]*TW[i]+0.12)) : al3(qa(DEP[i]*TW[i]*0.22)); o=j*8;
          data[o]=sx[i]*dpr; data[o+1]=sy[i]*dpr; data[o+2]=(pass ? RAD[i] : RAD[i]*2.4)*dpr; data[o+3]=0;
          data[o+4]=c[0]/255*a; data[o+5]=c[1]/255*a; data[o+6]=c[2]/255*a; data[o+7]=a; }
        disques(N, pass ? SRCOVER : LIGHTER);
      }
      // éclats : disques blancs puis croix (additifs, donc l'ordre n'importe pas)
      n = 0;
      for (j=0;j<N;j++){ i=order[j]; var spk=SPK[i]; if(!spk) continue; var aw=al3(qa(spk*0.5*DK[i])); o=n*8;
        data[o]=sx[i]*dpr; data[o+1]=sy[i]*dpr; data[o+2]=RK[i]*(0.7+spk*1.0)*dpr; data[o+3]=0;
        data[o+4]=WHITE[0]/255*aw; data[o+5]=WHITE[1]/255*aw; data[o+6]=WHITE[2]/255*aw; data[o+7]=aw; n++; }
      disques(n, LIGHTER);
      n = 0;
      for (j=0;j<N;j++){ i=order[j]; var sp2=SPK[i]; if(!sp2) continue; var ac=al3(qa(sp2*0.28*DK[i]))*FIL_A; o=n*8;
        data[o]=sx[i]*dpr; data[o+1]=sy[i]*dpr; data[o+2]=RK[i]*(1.6+sp2*2.0)*dpr; data[o+3]=FIL ? 0.5 : 0.5*dpr;
        data[o+4]=SPARK[0]/255*ac; data[o+5]=SPARK[1]/255*ac; data[o+6]=SPARK[2]/255*ac; data[o+7]=ac; n++; }
      if (n){
        pr = PR.croix; gl.useProgram(pr.p); gl.uniform2f(pr.u.u_res, SC.w, SC.h); gl.uniform1f(pr.u.u_s, FIL ? 1 : 0); envoyer(n, 32); fusion(LIGHTER);
        attributs(pr, [['q',2,0,0,bufQ],['c',4,0,1,bufI],['col',4,16,1,bufI]], 32);
        ext.drawArraysInstancedANGLE(gl.TRIANGLE_STRIP, 0, 4, n);
      }
      // lueur : réduction bilinéaire à 40 %, flou gaussien 3 px, puis ajout à 50 % agrandi
      var pp = PR.plein, pf = PR.flou;
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, B1.fb); gl.viewport(0, 0, bw, bh);
      gl.useProgram(pp.p); attributs(pp, [['q',2,0,0,bufQ]], 0);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, SC.tx); gl.uniform1i(pp.u.u_t, 0);
      gl.uniform2f(pp.u.u_dst, bw, bh); gl.uniform1f(pp.u.u_a, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.useProgram(pf.p); attributs(pf, [['q',2,0,0,bufQ]], 0); gl.uniform1i(pf.u.u_t, 0);
      gl.uniform2f(pf.u.u_px, 1/bw, 1/bh); gl.uniform2f(pf.u.u_n, bw, bh); gl.uniform1fv(pf.u.u_w, POIDS);
      gl.bindFramebuffer(gl.FRAMEBUFFER, B2.fb); gl.bindTexture(gl.TEXTURE_2D, B1.tx); gl.uniform2f(pf.u.u_dir, 1, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, B1.fb); gl.bindTexture(gl.TEXTURE_2D, B2.tx); gl.uniform2f(pf.u.u_dir, 0, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // image finale : la scène, puis la lueur
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, SC.w, SC.h);
      gl.useProgram(pp.p); attributs(pp, [['q',2,0,0,bufQ]], 0);
      gl.bindTexture(gl.TEXTURE_2D, SC.tx); gl.uniform2f(pp.u.u_dst, SC.w, SC.h); gl.uniform1f(pp.u.u_a, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      fusion(LIGHTER);
      gl.bindTexture(gl.TEXTURE_2D, B1.tx); gl.uniform2f(pp.u.u_dst, W*dpr, H*dpr); gl.uniform1f(pp.u.u_a, 0.5);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // lueur du logo : au-dessus de tout le reste du canvas, sous le logo (élément HTML posé au-dessus)
      if (lPret && tl !== undefined) lueurPoser(tl, th);
    }
    return { gl:gl, taille:taille, dessiner:dessiner };
  }

  // Choix du rendu : WebGL d'abord ; s'il est indisponible, ou si son contexte est perdu, on remplace
  // le canvas (un canvas qui a servi au WebGL ne peut plus donner de contexte 2D) et on repasse au 2D.
  function passer2D(){
    if (GLR) { GLR = null; var neuf = document.createElement('canvas'); neuf.className = 'morph-canvas'; stage.replaceChild(neuf, canvas); canvas = neuf; }
    ctx = canvas.getContext('2d');
    // canvas hors-écran basse résolution pour un bloom rapide
    bcanvas = document.createElement('canvas');
    bctx = bcanvas.getContext('2d');
  }
  var essai = creerRenduGL(canvas);
  if (essai && essai !== 'perdu') {
    GLR = essai;
    canvas.addEventListener('webglcontextlost', function(e){ e.preventDefault(); stage.classList.remove('lueur-gl'); passer2D(); size(); }, false);
  } else {
    if (essai === 'perdu') GLR = {};   // le canvas a déjà un contexte WebGL : passer2D le remplace
    passer2D();
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
