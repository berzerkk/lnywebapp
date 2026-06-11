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

  var COLORS = ['#be6e54', '#f3ad99', '#cf855f', '#e8b9a6', '#ffe2bd', '#a8593c'].map(hx);
  function hx(c){ c=c.replace('#',''); return [parseInt(c.substr(0,2),16),parseInt(c.substr(2,2),16),parseInt(c.substr(4,2),16)]; }
  function css(rgb,a){ return 'rgba('+(rgb[0]|0)+','+(rgb[1]|0)+','+(rgb[2]|0)+','+a.toFixed(3)+')'; }

  var N = 200;
  var P = [];
  for (var i=0;i<N;i++) P.push({ x:0,y:0,z:0, c:COLORS[(Math.random()*COLORS.length)|0], s:1.1+Math.random()*1.6, ph:Math.random()*6.28 });

  // rayons lumineux asymétriques / aléatoires émanant du logo
  var RAYS = [];
  (function(){ for(var i=0;i<10;i++){ RAYS.push({ a:Math.random()*6.283, len:1.3+Math.random()*1.9, w:0.018+Math.random()*0.03, sp:0.5+Math.random()*1.5, ph:Math.random()*6.283, rot:(Math.random()-0.5)*0.07 }); } })();

  var W=1,H=1,cx=0,cy=0,R=1,rIn=1,D=1, scenes=[];

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
    cx=W/2; cy=H/2; R=Math.min(W,H)*0.44; rIn=Math.min(W,H)*0.24; D=R*3.4;
    scenes = META.map(function(m){ return m.b(); });
  }

  var t0=0, sceneStart=0, SCENE_MS=4400;
  var rx=[],ry=[],rz=[],sx=[],sy=[],ff=[],order=[];

  function frame(now){
    if(!t0){ t0=now; sceneStart=now; }
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
      order[i]=i;
    }
    order.sort(function(a,b){ return rz[a]-rz[b]; }); // loin -> près

    ctx.clearRect(0,0,W,H);

    // --- NOYAU DE GALAXIE : halo lumineux qui palpite derrière le logo ------
    var pulse = 0.5 + 0.5*Math.sin(t*1.7);
    ctx.globalCompositeOperation = 'lighter';
    // grand bloom diffus
    var bloomR = R*(1.05 + 0.10*pulse);
    var gb = ctx.createRadialGradient(cx,cy,0,cx,cy,bloomR);
    gb.addColorStop(0.00,'rgba(255,242,220,'+(0.34+0.12*pulse).toFixed(3)+')');
    gb.addColorStop(0.18,'rgba(255,206,158,'+(0.22+0.10*pulse).toFixed(3)+')');
    gb.addColorStop(0.55,'rgba(207,133,95,0.08)');
    gb.addColorStop(1.00,'rgba(190,110,84,0)');
    ctx.fillStyle=gb; ctx.beginPath(); ctx.arc(cx,cy,bloomR,0,6.283); ctx.fill();
    // cœur chaud, plus serré
    var coreR = R*(0.46 + 0.06*pulse);
    var gc = ctx.createRadialGradient(cx,cy,0,cx,cy,coreR);
    gc.addColorStop(0.00,'rgba(255,251,240,'+(0.85*(0.85+0.15*pulse)).toFixed(3)+')');
    gc.addColorStop(0.30,'rgba(255,224,184,'+(0.55*(0.85+0.15*pulse)).toFixed(3)+')');
    gc.addColorStop(0.70,'rgba(232,160,118,0.20)');
    gc.addColorStop(1.00,'rgba(207,133,95,0)');
    ctx.fillStyle=gc; ctx.beginPath(); ctx.arc(cx,cy,coreR,0,6.283); ctx.fill();
    // rayons lumineux asymétriques qui jaillissent du logo
    for(var ri=0; ri<RAYS.length; ri++){
      var rj=RAYS[ri];
      var beat=Math.max(0,Math.sin(t*rj.sp+rj.ph));
      var L = coreR*rj.len*(0.5+0.5*beat);
      var wd = R*rj.w*(0.7+0.3*beat);
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(rj.a + t*rj.rot);
      var gr = ctx.createLinearGradient(0,0,L,0);
      var al = 0.08+0.18*beat;
      gr.addColorStop(0.00,'rgba(255,242,218,'+al.toFixed(3)+')');
      gr.addColorStop(0.45,'rgba(255,206,158,'+(al*0.45).toFixed(3)+')');
      gr.addColorStop(1.00,'rgba(255,190,140,0)');
      ctx.fillStyle=gr;
      ctx.beginPath(); ctx.moveTo(0,-wd); ctx.lineTo(L,-wd*0.10); ctx.lineTo(L,wd*0.10); ctx.lineTo(0,wd); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';

    // connexions (cerveau / circuit) — distance 3D (invariante par rotation)
    if(meta.t==='net'){
      var th=R*0.42;
      ctx.lineWidth=1;
      for(i=0;i<N;i++){ for(var k=i+1;k<N;k++){
        var dx=P[i].x-P[k].x, dy=P[i].y-P[k].y, dz=P[i].z-P[k].z, d=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(d>th) continue;
        var fa=(ff[i]+ff[k])*0.5;
        ctx.strokeStyle=css([190,110,84], (1-d/th)*0.30*Math.min(1,fa));
        ctx.beginPath(); ctx.moveTo(sx[i],sy[i]); ctx.lineTo(sx[k],sy[k]); ctx.stroke();
      } }
    }

    // halos additifs (brillance, du fond vers l'avant)
    ctx.globalCompositeOperation='lighter';
    for(var o=0;o<N;o++){
      i=order[o]; var f=ff[i];
      var depth=Math.max(0.25, Math.min(1, (f-0.74)/0.62));
      var tw=(meta.t==='dots')?(0.6+0.4*Math.sin(t*2+P[i].ph)):1;
      var rad=P[i].s*f*(meta.t==='paint'?1.7:1);
      ctx.fillStyle=css(P[i].c, depth*tw*0.22);
      ctx.beginPath(); ctx.arc(sx[i],sy[i],rad*2.4,0,6.283); ctx.fill();
    }
    // cœur brillant des particules
    ctx.globalCompositeOperation='source-over';
    for(var o2=0;o2<N;o2++){
      i=order[o2]; var f2=ff[i];
      var depth2=Math.max(0.25, Math.min(1, (f2-0.74)/0.62));
      var tw2=(meta.t==='dots')?(0.6+0.4*Math.sin(t*2+P[i].ph)):1;
      var rad2=P[i].s*f2*(meta.t==='paint'?1.7:1);
      ctx.fillStyle=css(P[i].c, Math.min(1, depth2*tw2+0.12));
      ctx.beginPath(); ctx.arc(sx[i],sy[i],rad2,0,6.283); ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  size();
  // init sur la sphère/anneau
  var p0=scenes[0]; for(var j=0;j<N;j++){ P[j].x=p0[j][0]; P[j].y=p0[j][1]; P[j].z=p0[j][2]; }
  if(reduce){ scenes && (function(){ var pts=scenes[1]; for(var i=0;i<N;i++){P[i].x=pts[i][0];P[i].y=pts[i][1];P[i].z=pts[i][2];} })(); requestAnimationFrame(function(n){ frame(n); }); }
  else requestAnimationFrame(frame);

  var rt; window.addEventListener('resize', function(){ clearTimeout(rt); rt=setTimeout(size,180); });
})();
