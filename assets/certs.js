/* Bulles « Certifications préparées » + modal détaillé — PARTAGÉ landing + formations.
   Usage : un conteneur #cert-chips avec des <span class="chip solid c-link" data-cert="…">.
   Le modal (#cert-modal) est injecté automatiquement ; styles dans site.css (.cert-modal/.cm-*). */
(function(){
  var MODAL =
    '<div id="cert-modal" class="cert-modal" aria-hidden="true" role="dialog" aria-modal="true">' +
      '<div class="cm-backdrop"></div>' +
      '<div class="cm-inner">' +
        '<div class="cm-card">' +
          '<button class="cm-close" id="cm-close" aria-label="Fermer">&times;</button>' +
          '<div class="cm-scroll">' +
            '<div class="cm-eyebrow" id="cm-eyebrow"></div>' +
            '<div class="cm-headrow"><h3 class="cm-title" id="cm-title"></h3><span class="cm-fullname" id="cm-fullname"></span></div>' +
            '<p class="cm-intro" id="cm-intro"></p>' +
            '<div id="cm-blocks"></div>' +
            '<div class="cm-actions">' +
              '<a href="contact.html" class="btn btn-primary">Être rappelé →</a>' +
              '<a href="test-de-niveau.html" class="btn btn-ghost">Faire le test de niveau →</a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  if(!document.getElementById('cert-chips')) return;
  if(!document.getElementById('cert-modal')) document.body.insertAdjacentHTML('beforeend', MODAL);
  var modal=document.getElementById('cert-modal'); if(!modal) return;
  var elEye=document.getElementById('cm-eyebrow'),elName=document.getElementById('cm-title'),elFull=document.getElementById('cm-fullname'),elIntro=document.getElementById('cm-intro'),elBlocks=document.getElementById('cm-blocks'),closeBtn=document.getElementById('cm-close');
  function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  /* pictos SVG (trait accent) : compétences + carrés de stats */
  var IC={
    listen:'<path d="M4 18v-5a8 8 0 0 1 16 0v5"/><rect x="2.8" y="13.6" width="4.4" height="6" rx="2.1"/><rect x="16.8" y="13.6" width="4.4" height="6" rx="2.1"/>',
    read:'<path d="M12 6c-1.6-1.3-3.7-2-6-2H5v14h1c2.3 0 4.4.7 6 2 1.6-1.3 3.7-2 6-2h1V4h-1c-2.3 0-4.4.7-6 2z"/><path d="M12 6v14"/>',
    speak:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>',
    write:'<path d="M4.5 19.5l.9-3.6L15.8 5.5l2.7 2.7L8.1 18.6l-3.6.9z"/><path d="M13.9 7.4l2.7 2.7"/>',
    chat:'<path d="M16 4H4v8.5h2.5V16l3.5-3.5H16V4z"/><path d="M19 8.5h1v8.5h-2v2.5l-3-2.5h-3.5"/>',
    grid:'<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
    kase:'<rect x="3.5" y="7.5" width="17" height="12" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3.5 12.5h17"/>',
    grad:'<path d="M12 4L2.5 8.5 12 13l9.5-4.5L12 4z"/><path d="M6.5 10.8V15c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.2"/>'
  };
  function svg(p){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+p+'</svg>';}
  function icFor(cd){
    if(cd.ic) return cd.ic;
    var t=(cd.title+' '+(cd.sub||'')).toLowerCase();
    if(t.indexOf('interaction')>-1) return 'chat';
    if(t.indexOf('4 skills')>-1) return 'grid';
    if(t.indexOf('business')>-1) return 'kase';
    if(t.indexOf('general english')>-1) return 'chat';
    if(t.indexOf('reading and listening')>-1) return 'read';
    if(t.indexOf('listening')>-1||t.indexOf('compréhension orale')>-1) return 'listen';
    if(t.indexOf('reading')>-1||t.indexOf('compréhension écrite')>-1) return 'read';
    if(t.indexOf('speaking')>-1||t.indexOf('expression orale')>-1) return 'speak';
    if(t.indexOf('writing')>-1||t.indexOf('expression écrite')>-1) return 'write';
    return null;
  }
  function card(cd){
    var ic=icFor(cd);
    var meta=cd.meta?'<span class="cm-cmeta">'+esc(cd.meta)+'</span>':'';
    var sub=cd.sub?'<div class="cm-csub">'+esc(cd.sub)+'</div>':'';
    var desc=cd.desc?'<p class="cm-cdesc">'+esc(cd.desc).replace(/\n/g,'<br>')+'</p>':'';
    return '<div class="cm-c'+(cd.tint?' tint-'+cd.tint:'')+'"><div class="cm-ctop">'+(ic?'<span class="cm-cic">'+svg(IC[ic])+'</span>':'')+'<div class="cm-ctitle">'+esc(cd.title)+'</div>'+meta+'</div>'+sub+desc+'</div>';
  }
  function block(b){
    if(b.type==='box') return '<div class="cm-box">'+(b.head?'<div class="cm-boxhead">'+esc(b.head)+'</div>':'')+(b.blocks||[]).map(block).join('')+'</div>';
    if(b.type==='stats') return '<div class="cm-stats">'+b.items.map(function(s){return '<div class="cm-stat'+(s.nw?' nw':'')+'"><div class="cm-stat-n">'+esc(s.n)+'</div><div class="cm-stat-l">'+esc(s.l)+'</div></div>';}).join('')+'</div>';
    if(b.type==='points') return '<ul class="cm-list">'+b.items.map(function(p){return '<li>'+esc(p)+'</li>';}).join('')+'</ul>';
    if(b.type==='callout') return '<div class="cm-callout'+(b.cpf?' cpf':'')+'">'+esc(b.text)+'</div>';
    if(b.type==='badges') return '<div class="cm-badrow">'+b.items.map(function(x){var i=x.indexOf(' — ');var h=i>-1?esc(x.slice(0,i))+'<br/>'+esc('— '+x.slice(i+3)):esc(x);return '<div class="cm-badbox">'+h+'</div>';}).join('')+'</div>';
    if(b.type==='note') return '<p class="cm-note">'+esc(b.text)+'</p>';
    if(b.type==='subhead') return '<div class="cm-subhead">'+esc(b.text)+'</div>';
    if(b.type==='cards'){
      var h=b.title?'<div class="cm-group-h">'+esc(b.title)+(b.cpf?' <span class="cm-cpftag">CPF</span>':'')+'</div>':'';
      return '<div class="cm-group'+(b.cpf?' cpf':'')+'">'+h+'<div class="cm-cards">'+b.items.map(card).join('')+'</div></div>';
    }
    return '';
  }
  var CERTS={
    "TOEIC":{
      eyebrow:"Certification · Anglais professionnel",
      name:"TOEIC", fullname:"Test of English for International Communication",
      intro:"Centre de préparation et de passage agréé TOEIC, partenaire d'ETS Global.",
      blocks:[
        {type:"box",head:"TOEIC 4 skills — Éligible CPF · RS 7229",blocks:[
          {type:"stats",items:[{n:"1 h 20",l:"durée totale"},{n:"Distanciel",l:"passage"},{n:"CECRL A1–C1",nw:true,l:"score sur 100"},{n:"2 ans",l:"validité"}]},
          {type:"points",items:["Accès libre 24 h/24 et 7 j/7","Score : 25 points par compétence + moyenne globale","Badge numérique partageable (LinkedIn)","Nouveau format dès le 3 août 2026"]},
          {type:"cards",title:"Les 4 compétences évaluées",items:[
            {title:"Listening",sub:"Compréhension orale",desc:"Comprendre des conversations, des annonces et des échanges du quotidien professionnel."},
            {title:"Reading",sub:"Compréhension écrite",desc:"Phrases et textes à compléter, puis compréhension de documents professionnels."},
            {title:"Speaking",sub:"Expression orale",desc:"Lire un texte à voix haute, décrire une image, donner son opinion."},
            {title:"Writing",sub:"Expression écrite",desc:"Décrire une image, répondre à un e-mail formel, rédiger un essai argumenté."}
          ]}
        ]},
        {type:"cards",title:"Les autres versions",items:[
          {title:"TOEIC Listening & Reading",ic:"listen",sub:"Compréhension orale et écrite · score sur 990",meta:"2 h",desc:"200 questions : 45 min d'écoute (100 questions) et 75 min de lecture (100 questions)."},
          {title:"TOEIC Speaking & Writing",ic:"speak",sub:"Expression orale et écrite · score sur 200",meta:"1 h 20",desc:"20 min d'expression orale (11 questions) et 1 h d'expression écrite (8 questions)."},
          {title:"TOEIC Bridge",ic:"grad",sub:"Compréhension orale et écrite — débutants · CECRL A1–B1 · score sur 100",meta:"1 h",desc:"25 min (50 questions) et 35 min (50 questions)."}
        ]}
      ]
    },
    "TOEFL":{
      eyebrow:"Certification · Anglais académique",
      name:"TOEFL iBT", fullname:"Test of English as a Foreign Language Internet-Based Test",
      intro:"Centre de préparation et de passage agréé TOEFL iBT, partenaire d'ETS Global.",
      blocks:[
        {type:"stats",items:[{n:"< 2 h",l:"durée totale"},{n:"Distanciel ou présentiel",l:"passage"},{n:"CECRL A1–C1",nw:true,l:"score sur 120"},{n:"2 ans",l:"validité"}]},
        {type:"cards",title:"Les 4 compétences évaluées",items:[
          {title:"Listening",sub:"Compréhension orale · Adaptatif",meta:"~29 min",desc:"Cours, conversations et échanges de la vie universitaire."},
          {title:"Reading",sub:"Compréhension écrite · Adaptatif",meta:"~30 min",desc:"Textes académiques, en deux modules de difficulté ajustée à votre niveau."},
          {title:"Speaking",sub:"Expression orale",meta:"~8 min",desc:"Tâches d'expression orale sur des sujets académiques."},
          {title:"Writing",sub:"Expression écrite",meta:"~23 min",desc:"Rédaction à partir de documents lus et écoutés."}
        ]}
      ]
    },
    "IELTS":{
      eyebrow:"Certification · Anglais",
      name:"IELTS", fullname:"International English Language Testing System",
      intro:"Centre de préparation au IELTS (Academic et General Training).",
      blocks:[
        {type:"stats",items:[{n:"2 h 45",l:"durée totale"},{n:"Distanciel ou présentiel",l:"passage"},{n:"CECRL A1–C2",nw:true,l:"score sur 9"},{n:"2 ans",l:"validité"}]},
        {type:"cards",title:"Les 4 compétences évaluées",items:[
          {title:"Compréhension orale",sub:"Listening",meta:"~30 min",desc:"40 questions à partir d'enregistrements audio variés."},
          {title:"Compréhension écrite",sub:"Reading",meta:"1 h",desc:"40 questions, sur trois textes en version Academic."},
          {title:"Expression orale",sub:"Speaking",meta:"11–14 min",desc:"Un entretien oral avec un examinateur, en trois temps."},
          {title:"Expression écrite",sub:"Writing",meta:"1 h",desc:"Deux rédactions, d'environ 150 et 250 mots."}
        ]}
      ]
    },
    "Bright Language":{
      eyebrow:"Certification · Multilingue",
      name:"Bright Language", fullname:"Bright Language",
      intro:"Centre de préparation et de passage agréé Bright Language, partenaire Mahoney Training Consultants (MTC).",
      blocks:[
        {type:"box",blocks:[
          {type:"badges",items:["BL Anglais — Éligible CPF · RS 6663","BL Français langue étrangère — Éligible CPF · RS 6481"]},
          {type:"stats",items:[{n:"2 h",l:"durée totale"},{n:"Distanciel",l:"passage"},{n:"CECRL A1–C2",nw:true,l:"score sur 5"},{n:"2 ans",l:"validité"}]},
          {type:"cards",title:"Les 5 compétences évaluées",items:[
            {title:"Listening",sub:"Compréhension orale",desc:"60 questions sur des extraits audio."},
            {title:"Reading",sub:"Compréhension écrite",desc:"QCM en ligne de 60 questions."},
            {title:"Speaking",sub:"Expression orale",desc:"En visioconférence : se présenter et exposer ses objectifs."},
            {title:"Writing",sub:"Expression écrite",desc:"Rédiger un e-mail, puis un texte d'environ 140 mots."},
            {title:"Spoken Interaction",sub:"Interaction orale",desc:"Dialoguer avec l'évaluateur natif, en contexte professionnel."}
          ]}
        ]},
        {type:"subhead",text:"Bright Language Listening & Reading"},
        {type:"stats",items:[{n:"1 h",l:"durée totale"},{n:"Distanciel ou présentiel",l:"passage"},{n:"CECRL A1–C2",nw:true,l:"score sur 5"},{n:"2 ans",l:"validité"}]},
        {type:"note",text:"Disponible en 11 langues (anglais, français, espagnol, italien, allemand, portugais, néerlandais, flamand, suédois, russe, chinois mandarin)."},
        {type:"note",text:"Compréhension orale et écrite : 60 questions sur des extraits audio et QCM en ligne de 60 questions."}
      ]
    },
    "Linguaskill":{
      eyebrow:"Certification · Anglais",
      name:"Linguaskill", fullname:"from Cambridge",
      intro:"Centre de préparation au Linguaskill from Cambridge.",
      blocks:[
        {type:"stats",items:[{n:"2 h",l:"durée totale (test complet, modulable)"},{n:"Distanciel ou présentiel",l:"passage"},{n:"CECRL B1–C2",nw:true,l:"score sur 210"},{n:"2 ans",l:"validité"}]},
        {type:"cards",title:"Deux parcours",items:[
          {title:"Linguaskill General English",tint:"a"},
          {title:"Linguaskill Business",tint:"b"}
        ]},
        {type:"cards",title:"Les 4 compétences évaluées",items:[
          {title:"Linguaskill 4 Skills",meta:"2 h 20 min",desc:"Compréhension écrite & orale\nExpression orale\nExpression écrite"},
          {title:"Linguaskill Reading and Listening",meta:"1 h 20",desc:"Compréhension écrite & orale\nQCM et textes à compléter, qui s'adaptent à votre niveau."},
          {title:"Linguaskill Speaking",meta:"16 min",desc:"Expression orale\n5 sections : se présenter, répondre à des questions, lire des phrases à voix haute, décrire une image et donner son avis."},
          {title:"Linguaskill Writing",meta:"45 min",desc:"Expression écrite\nRédiger un message court (souvent un e-mail), puis un texte long et structuré sur un sujet donné."}
        ]}
      ]
    },
    "Duolingo English Test":{
      eyebrow:"Certification · Anglais",
      name:"Duolingo English Test",
      intro:"Centre de préparation au Duolingo English Test.",
      blocks:[
        {type:"stats",items:[{n:"1 h",l:"durée totale"},{n:"Distanciel",l:"passage"},{n:"CECRL A1–C2",nw:true,l:"score sur 160"},{n:"2 ans",l:"validité"}]},
        {type:"subhead",text:"1ʳᵉ partie · 45 min"},
        {type:"cards",title:"Les 4 compétences évaluées",items:[
          {title:"Listening",sub:"Compréhension orale · Adaptatif",desc:"Vous écoutez des enregistrements, retranscrivez ce que vous entendez, puis répondez à un QCM."},
          {title:"Reading",sub:"Compréhension écrite · Adaptatif",desc:"Vous complétez des mots, repérez les vrais mots anglais et répondez à des questions de compréhension."},
          {title:"Speaking",sub:"Expression orale · Adaptatif",desc:"Vous lisez des phrases à voix haute et décrivez une photo à l'oral."},
          {title:"Writing",sub:"Expression écrite · Adaptatif",desc:"Vous décrivez une photo par écrit, puis vous lisez une consigne et rédigez une réponse plus développée."}
        ]},
        {type:"subhead",text:"2ᵉ partie · 10 min"},
        {type:"note",text:"Entretien vidéo (non évalué) · Échantillon d'écriture (non évalué)."}
      ]
    }
  };
  function open(key){
    var c=CERTS[key]; if(!c) return;
    elEye.textContent=c.eyebrow||'';
    elName.textContent=c.name||key;
    elFull.textContent=c.fullname||''; elFull.style.display=c.fullname?'':'none';
    elIntro.textContent=c.intro||''; elIntro.style.display=c.intro?'':'none';
    elBlocks.innerHTML=(c.blocks||[]).map(block).join('');
    var sc=modal.querySelector('.cm-scroll'); if(sc) sc.scrollTop=0;
    /* cascade : chaque bloc (y compris l'intérieur des rectangles) arrive avec un léger décalage */
    var seq=[];
    [].forEach.call(sc.children,function(el){
      if(el.id==='cm-blocks'){ [].forEach.call(el.children,function(c){ if(c.classList.contains('cm-box')){ [].forEach.call(c.children,function(g){ seq.push(g); }); } else { seq.push(c); } }); }
      else if(el.style.display!=='none'){ seq.push(el); }
    });
    seq.forEach(function(el,i){ el.classList.add('cm-in'); el.style.animationDelay=(0.05+i*0.055).toFixed(3)+'s'; });
    modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';
  }
  function close(){modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.style.overflow='';}
  document.querySelectorAll('#cert-chips .chip.c-link').forEach(function(ch){ch.addEventListener('click',function(){open(ch.getAttribute('data-cert'));});});
  closeBtn.addEventListener('click',close);
  modal.addEventListener('click',function(e){if(!e.target.closest('.cm-card'))close();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&modal.classList.contains('open'))close();});
})();
