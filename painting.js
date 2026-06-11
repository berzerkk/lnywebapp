/* ============================================================================
   L&S — Tableau impressionniste animé (Canvas 2D)
   Un pinceau stylisé construit, touche par touche, une scène d'un groupe de
   personnes suggérées (montée en compétences d'une équipe), dans la palette
   chaude du site. Puis le tableau se dissout et le cycle recommence (~20 s).
   ============================================================================ */
(function () {
  'use strict';
  var cont = document.getElementById('ent-painting');
  if (!cont) return;
  var paintC = cont.querySelector('.paint-canvas');
  var brushC = cont.querySelector('.brush-canvas');
  if (!paintC || !brushC) return;
  var pctx = paintC.getContext('2d');
  var bctx = brushC.getContext('2d');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);

  // ---- helpers couleur (travail en [r,g,b]) -------------------------------
  function hx(c){ c=c.replace('#',''); return [parseInt(c.substr(0,2),16),parseInt(c.substr(2,2),16),parseInt(c.substr(4,2),16)]; }
  function cl(v){ return v<0?0:v>255?255:v; }
  function jit(rgb,a){ return [cl(rgb[0]+(Math.random()*2-1)*a), cl(rgb[1]+(Math.random()*2-1)*a), cl(rgb[2]+(Math.random()*2-1)*a)]; }
  function lighten(rgb,a){ return [cl(rgb[0]+a),cl(rgb[1]+a),cl(rgb[2]+a)]; }
  function css(rgb){ return 'rgb('+(rgb[0]|0)+','+(rgb[1]|0)+','+(rgb[2]|0)+')'; }
  function rr(a,b){ return a+Math.random()*(b-a); }
  function pick(a){ return a[(Math.random()*a.length)|0]; }

  // palette du site (chauds)
  var P = {
    sky:   ['#fbe6d8','#f3d2c0','#f3ad99','#e8b9a6','#ffe2bd','#fff2e2'].map(hx),
    glow:  ['#ffe2bd','#fff2e2','#ffd9a6','#fbe6d8'].map(hx),
    ground:['#a8593c','#8c4632','#6b4030','#be6e54','#97513f','#7a4a36'].map(hx),
    fig:   ['#a76a48','#be6e54','#8c4632','#b95d4a','#97513f'].map(hx),
    head:  hx('#e8b9a6'),
    light: ['#fffaf0','#ffe2bd','#fff2e2'].map(hx)
  };

  var W=1, H=1, strokes=[], total=0;

  // ---- composition : ordre = scatter, ciel, sol, figures, lumières --------
  function build(){
    var S=[];
    function add(x,y,ang,len,wid,rgb){ S.push({x:x,y:y,a:ang,l:len,w:wid,c:rgb}); }

    // 0) quelques touches éparses au départ
    for(var i=0;i<14;i++){ var b=pick([].concat(P.sky,P.ground,P.fig)); add(rr(0,W),rr(0,H),rr(0,Math.PI*2),rr(20,38),rr(10,16),jit(b,16)); }

    // 1) ciel / fond lumineux
    var sky=[];
    for(i=0;i<120;i++){ sky.push({x:rr(0,W),y:rr(0,H*0.6),a:rr(-0.22,0.22),l:rr(26,50),w:rr(11,19),c:jit(pick(P.sky),12)}); }
    // halo chaud haut-centre
    for(i=0;i<34;i++){ var ag=rr(0,Math.PI*2),rad=rr(0,W*0.22); sky.push({x:W*0.5+Math.cos(ag)*rad,y:H*0.25+Math.sin(ag)*rad*0.85,a:rr(0,Math.PI),l:rr(18,32),w:rr(10,15),c:jit(pick(P.glow),10)}); }
    sky.sort(function(a,b){return a.x-b.x;});
    sky.forEach(function(s){ S.push(s); });

    // 2) sol
    var grd=[];
    for(i=0;i<95;i++){ grd.push({x:rr(0,W),y:rr(H*0.64,H),a:rr(-0.16,0.16),l:rr(28,54),w:rr(13,21),c:jit(pick(P.ground),14)}); }
    grd.sort(function(a,b){return a.x-b.x;});
    grd.forEach(function(s){ S.push(s); });

    // 3) groupe de figures suggérées
    var fx=[0.18,0.34,0.5,0.66,0.82];
    fx.forEach(function(fxr,fi){
      var base=P.fig[fi%P.fig.length];
      var cx=W*fxr, fw=W*0.085, topY=H*(0.50+(fi%2?0.03:0)), botY=H*0.86;
      for(var j=0;j<44;j++){ add(cx+rr(-fw,fw), rr(topY,botY), rr(Math.PI/2-0.22,Math.PI/2+0.22), rr(22,42), rr(10,17), jit(base,16)); }
      var hl=lighten(base,42);
      for(j=0;j<9;j++){ add(cx+rr(-fw*0.7,fw*0.7), rr(topY,topY+H*0.12), rr(Math.PI/2-0.3,Math.PI/2+0.3), rr(18,30), rr(8,12), jit(hl,12)); }
      var headY=topY-H*0.045;
      for(j=0;j<9;j++){ add(cx+rr(-fw*0.5,fw*0.5), headY+rr(-11,11), rr(0,Math.PI), rr(12,20), rr(8,12), jit(P.head,12)); }
    });

    // 4) lumières / liaisons (sparkle final)
    for(i=0;i<58;i++){ add(rr(0,W), rr(H*0.2,H*0.92), rr(0,Math.PI*2), rr(13,24), rr(6,11), jit(pick(P.light),8)); }

    strokes=S; total=S.length;
  }

  // ---- dépôt d'une touche texturée ----------------------------------------
  function stroke(ctx,s,alpha){
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.translate(s.x,s.y); ctx.rotate(s.a);
    ctx.lineCap='round';
    var n=3+(s.w>15?2:0), w2=s.l/2;
    for(var i=0;i<n;i++){
      var off=(i/(n-1)-0.5)*s.w;
      ctx.strokeStyle=css(jit(s.c,12));
      ctx.lineWidth=Math.max(1.3,(s.w/n)*(0.7+Math.random()*0.7));
      ctx.beginPath();
      ctx.moveTo(-w2, off+(Math.random()*2-1)*2);
      ctx.quadraticCurveTo(0, off+(Math.random()*2-1)*3, w2, off+(Math.random()*2-1)*2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- pinceau stylisé minimal --------------------------------------------
  function brush(x,y,rgb,press){
    bctx.clearRect(0,0,W,H);
    bctx.save();
    bctx.translate(x,y); bctx.rotate(-0.66);
    // ombre portée légère
    bctx.globalAlpha=0.18; bctx.fillStyle='#2a2118';
    bctx.beginPath(); bctx.ellipse(2,3,7,3.5,0,0,Math.PI*2); bctx.fill();
    bctx.globalAlpha=1;
    // manche
    bctx.strokeStyle='rgba(58,47,38,.92)'; bctx.lineCap='round';
    bctx.lineWidth=3.4; bctx.beginPath(); bctx.moveTo(7,7); bctx.lineTo(64,64); bctx.stroke();
    // virole
    bctx.strokeStyle='rgba(176,150,118,.95)'; bctx.lineWidth=4.4; bctx.beginPath(); bctx.moveTo(2,2); bctx.lineTo(12,12); bctx.stroke();
    // pointe (couleur en cours)
    bctx.fillStyle=css(rgb); bctx.shadowColor=css(rgb); bctx.shadowBlur=9;
    bctx.beginPath(); bctx.ellipse(-1,-1, 5.5+press*2.5, 3.2+press*1.4, 0.8, 0, Math.PI*2); bctx.fill();
    bctx.restore();
  }

  // ---- dimensionnement -----------------------------------------------------
  function size(){
    var r=cont.getBoundingClientRect();
    W=Math.max(1,r.width); H=Math.max(1,r.height);
    [paintC,brushC].forEach(function(cn){ cn.width=W*dpr; cn.height=H*dpr; });
    pctx.setTransform(dpr,0,0,dpr,0,0);
    bctx.setTransform(dpr,0,0,dpr,0,0);
  }

  function easeIO(t){ return t<0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2; }

  // ---- état réduit : tableau fini, statique --------------------------------
  function paintAll(){ pctx.clearRect(0,0,W,H); for(var i=0;i<total;i++) stroke(pctx,strokes[i],0.9); }

  // ---- boucle --------------------------------------------------------------
  var T=20000, PAINT=0.74, HOLD=0.80;   // fractions du cycle
  var startT=0, lastP=1, painted=0, bx=0, by=0, btx=0, bty=0;

  function reset(){ pctx.clearRect(0,0,W,H); bctx.clearRect(0,0,W,H); painted=0; bx=W*0.5; by=H*0.5; btx=bx; bty=by; }

  function frame(now){
    if(!startT) startT=now;
    var p=((now-startT)%T)/T;
    if(p<lastP) reset();           // nouveau cycle
    lastP=p;

    if(p<=PAINT){
      var pp=easeIO(p/PAINT);
      var target=Math.min(total, Math.floor(pp*total));
      var pressed=0;
      while(painted<target){ var s=strokes[painted]; stroke(pctx,s,0.9); btx=s.x; bty=s.y; painted++; pressed=1; }
      bx+=(btx-bx)*0.22; by+=(bty-by)*0.22;
      var cur=strokes[Math.min(painted,total-1)] || strokes[0];
      brush(bx,by, cur.c, pressed?1:0.25);
    } else if(p<=HOLD){
      bctx.clearRect(0,0,W,H);     // tableau fini, on admire
    } else {
      // dissolution -> révèle la toile chaude du fond
      pctx.save(); pctx.globalCompositeOperation='destination-out';
      pctx.globalAlpha=0.065; pctx.fillStyle='#000'; pctx.fillRect(0,0,W,H);
      pctx.restore();
      bctx.clearRect(0,0,W,H);
    }
    requestAnimationFrame(frame);
  }

  function init(){
    size(); build();
    if(reduce){ paintAll(); return; }
    reset(); requestAnimationFrame(frame);
  }

  var rt;
  window.addEventListener('resize', function(){ clearTimeout(rt); rt=setTimeout(function(){ size(); build(); startT=0; }, 200); });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
